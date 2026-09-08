//! Exact-build, process-local instrumentation for invocation evidence.
use serde_json::{json, Value};
use std::{cell::RefCell, mem, ptr};

type Trigger = unsafe extern "C" fn(*const u8, *const u8, *mut u8, bool, i32, *const u8);
type AddPending = unsafe extern "C" fn(*const u8, *const u8, *const u8, *const u8, i32, bool);
type Immediate = unsafe extern "C" fn(*const u8, *mut u8, i32, *const u8);
static mut TRIGGER: usize = 0;
static mut ADD: usize = 0;
static mut IMMEDIATE: usize = 0;
static mut AFTER: usize = 0;

#[derive(Default)]
struct Trace {
    active: bool,
    stack: Vec<usize>,
    records: Vec<Value>,
}
thread_local! { static TRACE: RefCell<Trace> = RefCell::new(Trace::default()); }

/// Start one main-thread invocation trace immediately before direct native firing.
pub fn begin() {
    TRACE.with(|t| {
        *t.borrow_mut() = Trace {
            active: true,
            ..Trace::default()
        }
    });
}
/// End the trace and retain the native call tree and completion observations.
pub fn finish() -> Value {
    TRACE.with(|t| {
        let mut t = t.borrow_mut();
        t.active = false;
        json!({"frames":t.records,"balanced":t.stack.is_empty()})
    })
}

unsafe extern "C" fn trigger(
    manager: *const u8,
    handle: *const u8,
    scope: *mut u8,
    flag: bool,
    mode: i32,
    userdata: *const u8,
) {
    let frame = TRACE.with(|trace| {
        let mut trace=trace.borrow_mut();
        if !trace.active { return None; }
        let index=trace.records.len();
        let parent=trace.stack.last().copied();
        trace.records.push(json!({"frame":index,"parent":parent,"handle":handle as usize,"scope":scope as usize,"immediateReturned":false,"returned":false,"pending":[]}));
        trace.stack.push(index); Some(index)
    });
    let original: Trigger = mem::transmute(TRIGGER);
    original(manager, handle, scope, flag, mode, userdata);
    if let Some(index) = frame {
        TRACE.with(|trace| {
            let mut trace = trace.borrow_mut();
            trace.records[index]["returned"] = json!(true);
            trace.stack.pop();
        });
    }
}

unsafe extern "C" fn immediate(event: *const u8, scope: *mut u8, mode: i32, userdata: *const u8) {
    let frame = TRACE.with(|t| t.borrow().stack.last().copied());
    let original: Immediate = mem::transmute(IMMEDIATE);
    original(event, scope, mode, userdata);
    if let Some(index) = frame {
        TRACE.with(|t| {
            let mut t = t.borrow_mut();
            t.records[index]["immediateReturned"] = json!(true);
            t.records[index]["definition"] = json!(event as usize);
        });
    }
}

unsafe extern "C" fn after(event: *const u8, scope: *mut u8) {
    let frame = TRACE.with(|t| t.borrow().stack.last().copied());
    let original: unsafe extern "C" fn(*const u8, *mut u8) = mem::transmute(AFTER);
    original(event, scope);
    if let Some(index) = frame {
        TRACE.with(|t| t.borrow_mut().records[index]["afterReturned"] = json!(true));
    }
}

unsafe extern "C" fn add_pending(
    state: *const u8,
    country: *const u8,
    handle: *const u8,
    scope: *const u8,
    id: i32,
    flag: bool,
) {
    let frame = TRACE.with(|t| t.borrow().stack.last().copied());
    let original: AddPending = mem::transmute(ADD);
    original(state, country, handle, scope, id, flag);
    if let Some(index) = frame {
        TRACE.with(|t| {
        let mut t=t.borrow_mut();
        t.records[index]["pending"].as_array_mut().unwrap().push(json!({"id":id,"handle":handle as usize,"scope":scope as usize,"country":country as usize,"insertionReturned":true}));
    });
    }
}

extern "C" {
    static mach_task_self_: u32;
    fn mach_vm_protect(
        task: u32,
        address: u64,
        size: u64,
        set_maximum: i32,
        protection: i32,
    ) -> i32;
    fn sys_icache_invalidate(address: *mut libc::c_void, length: usize);
}

unsafe fn jump(destination: usize) -> [u8; 16] {
    let mut bytes = [0; 16];
    bytes[0..4].copy_from_slice(&0x58000050u32.to_le_bytes()); // ldr x16, literal +8
    bytes[4..8].copy_from_slice(&0xd61f0200u32.to_le_bytes()); // br x16
    bytes[8..16].copy_from_slice(&destination.to_le_bytes());
    bytes
}

unsafe fn install_entry(
    address: usize,
    replacement: usize,
    expected: [u32; 4],
) -> Result<usize, String> {
    let source = address as *mut u8;
    for (index, instruction) in expected.iter().enumerate() {
        if ptr::read(source.add(index * 4).cast::<u32>()) != *instruction {
            return Err(format!("prologue mismatch at {address:x}"));
        }
    }
    let page_size = libc::sysconf(libc::_SC_PAGESIZE) as usize;
    let memory = libc::mmap(
        ptr::null_mut(),
        page_size,
        libc::PROT_READ | libc::PROT_WRITE,
        libc::MAP_PRIVATE | libc::MAP_ANON,
        -1,
        0,
    );
    if memory == libc::MAP_FAILED {
        return Err("trampoline allocation failed".into());
    }
    ptr::copy_nonoverlapping(source, memory.cast::<u8>(), 16);
    ptr::copy_nonoverlapping(jump(address + 16).as_ptr(), memory.cast::<u8>().add(16), 16);
    if libc::mprotect(memory, page_size, libc::PROT_READ | libc::PROT_EXEC) != 0 {
        return Err("trampoline protection failed".into());
    }
    sys_icache_invalidate(memory, 32);
    let page = address & !(page_size - 1);
    let writable = mach_vm_protect(
        mach_task_self_,
        page as u64,
        page_size as u64,
        0,
        1 | 2 | 0x10,
    );
    if writable != 0 {
        return Err(format!("code copy protection failed: {writable}"));
    }
    ptr::copy_nonoverlapping(jump(replacement).as_ptr(), source, 16);
    let executable = mach_vm_protect(mach_task_self_, page as u64, page_size as u64, 0, 1 | 4);
    if executable != 0 {
        return Err(format!("code execute protection failed: {executable}"));
    }
    sys_icache_invalidate(source.cast(), 16);
    Ok(memory as usize)
}

/// Install process-local hooks before the game starts, after exact-image admission.
/// Prologues contain only position-independent stack saves; no general relocation is attempted.
pub unsafe fn install(slide: usize) -> Result<(), String> {
    TRIGGER = install_entry(
        slide + 0x1004d82b0,
        trigger as *const () as usize,
        TRIGGER_BYTES,
    )?;
    ADD = install_entry(
        slide + 0x10074df38,
        add_pending as *const () as usize,
        ADD_BYTES,
    )?;
    IMMEDIATE = install_entry(
        slide + 0x1004bbc68,
        immediate as *const () as usize,
        IMMEDIATE_BYTES,
    )?;
    AFTER = install_entry(
        slide + 0x1004bbd10,
        after as *const () as usize,
        TRIGGER_BYTES,
    )?;
    COUNTRY_DTOR = install_entry(
        slide + 0x100223344,
        country_destroyed as *const () as usize,
        [0xa9ba6ffc, 0xa90167fa, 0xa9025ff8, 0xa90357f6],
    )?;
    PLANET_DTOR = install_entry(
        slide + 0x101131a2c,
        planet_destroyed as *const () as usize,
        [0xd10183ff, 0xa90357f6, 0xa9044ff4, 0xa9057bfd],
    )?;
    LOG = install_entry(
        slide + 0x101dbc168,
        log_effect as *const () as usize,
        [0xa9bc6ffc, 0xa90157f6, 0xa9024ff4, 0xa9037bfd],
    )?;
    crate::prepared::load()?;
    Ok(())
}
const TRIGGER_BYTES: [u32; 4] = [0xa9ba6ffc, 0xa90167fa, 0xa9025ff8, 0xa90357f6];
const ADD_BYTES: [u32; 4] = [0xd10183ff, 0xa90167fa, 0xa9025ff8, 0xa90357f6];
const IMMEDIATE_BYTES: [u32; 4] = [0xa9bb67fa, 0xa9015ff8, 0xa90257f6, 0xa9034ff4];

static mut COUNTRY_DTOR: usize = 0;
static mut PLANET_DTOR: usize = 0;
unsafe extern "C" fn country_destroyed(object: *const u8) {
    crate::locators::destroyed("country", object);
    let original: unsafe extern "C" fn(*const u8) = mem::transmute(COUNTRY_DTOR);
    original(object);
}
unsafe extern "C" fn planet_destroyed(object: *const u8) {
    crate::locators::destroyed("planet", object);
    let original: unsafe extern "C" fn(*const u8) = mem::transmute(PLANET_DTOR);
    original(object);
}

static mut LOG: usize = 0;
unsafe extern "C" fn log_effect(effect: *const u8, scope: *mut u8) {
    let original: unsafe extern "C" fn(*const u8, *mut u8) = mem::transmute(LOG);
    original(effect, scope);
    crate::prepared::marker(effect, scope);
}

//! Minimal bindings from the installed macOS dyld and dispatch headers.
use libc::{c_char, c_int, c_void};

#[repr(C)]
pub struct MachHeader {
    pub magic: u32,
    pub cpu_type: i32,
    pub cpu_subtype: i32,
    pub file_type: u32,
}

extern "C" {
    pub fn _dyld_image_count() -> u32;
    pub fn _dyld_get_image_header(index: u32) -> *const MachHeader;
    pub fn _dyld_get_image_vmaddr_slide(index: u32) -> isize;
    pub fn _dyld_get_image_name(index: u32) -> *const c_char;
    pub fn pthread_main_np() -> c_int;
    pub static _dispatch_main_q: u8;
    pub static _dispatch_source_type_timer: u8;
    pub fn dispatch_source_create(
        kind: *const u8,
        handle: usize,
        mask: usize,
        queue: *const u8,
    ) -> *mut c_void;
    pub fn dispatch_source_set_event_handler_f(
        source: *mut c_void,
        callback: extern "C" fn(*mut c_void),
    );
    pub fn dispatch_source_set_timer(source: *mut c_void, start: u64, interval: u64, leeway: u64);
    pub fn dispatch_time(when: u64, delta: i64) -> u64;
    pub fn dispatch_resume(object: *mut c_void);
}

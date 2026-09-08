//! Disposable ARM64 Rust bridge for a bounded Stellaris lifecycle probe.
#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

mod engine;
mod hooks;
mod locators;
mod platform;
mod prepared;

use libc::c_void;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::CStr,
    fs, io,
    panic::catch_unwind,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const GAME_STATE_SYMBOL: usize = 0x1032e53c0;
const IN_GAME_IDLER_SYMBOL: usize = 0x1032e53a8;
const JUMP_TO_NEXT_DAY_SYMBOL: usize = 0x1008790c8;
const GET_GAME_DATE_SYMBOL: usize = 0x100708360;
const FAST_FORWARD_DAYS_SYMBOL: usize = 0x1006f0a10;
const ACCESS_CHEAT_MANAGER_SYMBOL: usize = 0x1001079e8;
const TOGGLE_AI_SYMBOL: usize = 0x101338534;
const POST_EVENT_OPTION_SELECTION_SYMBOL: usize = 0x1004b78ac;
const GET_EVENT_OPTION_KEY_SYMBOL: usize = 0x1004de4e0;
const IS_OBSERVER_EVENT_SYMBOL: usize = 0x1004b749c;
const IS_OPTION_ALLOWED_SYMBOL: usize = 0x1004dd308;
const FIND_EXCLUSIVE_OPTION_SYMBOL: usize = 0x1004df8bc;
const IS_POTENTIAL_IGNORE_EXCLUSIVE_SYMBOL: usize = 0x1004de97c;

struct Bridge {
    directory: PathBuf,
    run: String,
    slide: usize,
    supported: bool,
    processing: AtomicBool,
    poll_ticks: AtomicU64,
    completed_requests: Mutex<HashMap<String, Value>>,
}

static BRIDGE: OnceLock<Bridge> = OnceLock::new();

fn unix_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

impl Bridge {
    fn write(&self, name: &str, value: &Value) -> io::Result<()> {
        let temporary = self.directory.join(format!("{name}.tmp"));
        fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
        fs::rename(temporary, self.directory.join(name))
    }

    fn process(&self, request: &Value, poll_ticks: u64) -> Value {
        let main_thread = unsafe { platform::pthread_main_np() != 0 };
        let (stack, normal_boundary) = self.stack();
        let mut response = json!({
            "id": request["id"],
            "invocation": request["invocation"],
            "pid": std::process::id(),
            "language": "rust",
            "run": self.run,
            "worldIdentity": format!("{}:{}", self.run, std::process::id()),
            "mainThread": main_thread,
            "supported": self.supported,
            "pollTicks": poll_ticks,
            "stack": stack,
            "normalInputBoundary": normal_boundary,
        });

        if !self.supported {
            response["status"] = json!("unsupported-binary-or-architecture");
            return response;
        }
        if !main_thread {
            response["status"] = json!("not-main-thread");
            return response;
        }
        if !normal_boundary {
            response["status"] = json!("outside-normal-input-boundary");
            return response;
        }
        if request["run"].as_str() != Some(&self.run) {
            response["status"] = json!("wrong-run");
            return response;
        }

        let world = format!("{}:{}", self.run, std::process::id());
        if request["action"].as_str() != Some("inspect") {
            if request["worldIdentity"].as_str() != Some(&world) {
                response["status"] = json!("stale-world");
                return response;
            }
            if request["expectedPid"].as_u64() != Some(std::process::id() as u64) {
                response["status"] = json!("wrong-process");
                return response;
            }
        }
        let request_id = request["id"].as_str().unwrap_or_default();
        let completed = self.completed_requests.lock().unwrap();
        if let Some(prior) = completed.get(request_id) {
            response["status"] = json!("duplicate-request");
            response["priorStatus"] = prior["status"].clone();
            response["state"] = unsafe { engine::snapshot(self.slide) }
                .unwrap_or_else(|reason| json!({"error": reason}));
            return response;
        }
        drop(completed);

        let before = unsafe { engine::snapshot(self.slide) }
            .unwrap_or_else(|reason| json!({"error": reason}));
        response["stateBefore"] = before.clone();
        match request["action"].as_str() {
            Some("invoke-prepared") => {
                response["prepared"] =
                    unsafe { prepared::invoke(self.slide, request, &before, &world) };
                response["status"] = response["prepared"]["status"].clone();
            }
            Some("resource-inventory") => {
                response["resources"] = unsafe { prepared::inventory(self.slide) };
                response["status"] = response["resources"]["status"].clone();
            }
            Some("read-stockpile") => {
                response["read"] = unsafe { prepared::read(self.slide, request, &before, &world) };
                response["status"] = response["read"]["status"].clone();
            }
            Some("locator-inspect") => {
                response["locator"] = unsafe { locators::inspect(self.slide) };
                response["status"] = response["locator"]["status"].clone();
            }
            Some("bind") => {
                response["locator"] = unsafe { locators::acquire(self.slide, request, &world) };
                response["status"] = response["locator"]["status"].clone();
            }
            Some("validate-binding") => {
                response["locator"] = unsafe { locators::validate(self.slide, request, &world) };
                response["status"] = response["locator"]["status"].clone();
            }
            Some("switch-player-control") => {
                response["locator"] = unsafe { locators::switch_player(self.slide, request) };
                response["status"] = response["locator"]["status"].clone();
            }
            Some("save") => {
                response["status"] =
                    json!(unsafe { engine::save_game(self.slide, request, &before) });
            }
            Some("inspect") => response["status"] = json!("inspected"),
            Some("advance-day") => {
                response["status"] =
                    json!(unsafe { engine::advance_one_day(self.slide, request, &before) })
            }
            Some("fast-forward") => {
                let acceptance = json!({
                    "id": request["id"],
                    "run": request["run"],
                    "action": "fast-forward",
                    "status": "fast-forward-accepted",
                    "acceptedAtUnixMs": unix_time_millis(),
                    "mainThread": main_thread,
                    "normalInputBoundary": normal_boundary,
                    "pollTicks": poll_ticks,
                    "stateBefore": before,
                });
                if self
                    .write(&format!("accepted-{request_id}.json"), &acceptance)
                    .is_err()
                {
                    response["status"] = json!("acceptance-evidence-failed");
                } else {
                    response["status"] =
                        json!(unsafe { engine::fast_forward(self.slide, request, &before) });
                }
            }
            Some("set-ai") => {
                let outcome = unsafe { engine::establish_ai(self.slide, request, &before) };
                response["status"] = outcome["status"].clone();
                response["ai"] = outcome;
            }
            Some("fire-event") => {
                let accepted = json!({"id": request["id"], "run": self.run, "worldIdentity": world, "status": "fire-dispatch-requested", "stateBefore": before});
                if self
                    .write(&format!("accepted-{request_id}.json"), &accepted)
                    .is_err()
                {
                    response["status"] = json!("acceptance-evidence-failed");
                } else {
                    if request["eventId"] == "sdk442_probe.2" {
                        locators::begin_setup();
                    }
                    let mut outcome = unsafe { engine::fire_event(self.slide, request, &before) };
                    response["status"] = outcome["status"].clone();
                    if outcome["status"] == "fire-completed" {
                        outcome["handle"]["invocationId"] = request["id"].clone();
                        outcome["handle"]["worldIdentity"] = json!(world);
                        outcome["handle"]["pid"] = json!(std::process::id());
                    }
                    response["fire"] = outcome;
                }
            }
            Some("choose-fired") => {
                let handle = &request["handle"];
                if handle["worldIdentity"].as_str() != Some(&world) {
                    response["status"] = json!("stale-world");
                } else {
                    let completed = self.completed_requests.lock().unwrap();
                    let original = handle["invocationId"]
                        .as_str()
                        .and_then(|id| completed.get(id));
                    if original.map(|prior| &prior["fire"]["handle"]) != Some(handle) {
                        response["status"] = json!("unknown-fired-handle");
                    } else if handle["pendingId"].is_null() {
                        response["status"] = json!("no-pending-player-choice");
                    } else {
                        let mut selection = request.clone();
                        selection["pendingId"] = handle["pendingId"].clone();
                        selection["eventId"] = handle["eventId"].clone();
                        selection["countryId"] = handle["countryId"].clone();
                        let outcome =
                            unsafe { engine::select_event(self.slide, &selection, &before) };
                        response["status"] = outcome["status"].clone();
                        response["selection"] = outcome;
                    }
                }
            }
            Some("select-event") => {
                let outcome = unsafe { engine::select_event(self.slide, request, &before) };
                response["status"] = outcome["status"].clone();
                response["selection"] = outcome;
            }
            _ => response["status"] = json!("unknown-action"),
        }
        response["stateAfterAcceptance"] = unsafe { engine::snapshot(self.slide) }
            .unwrap_or_else(|reason| json!({"error": reason}));
        self.completed_requests
            .lock()
            .unwrap()
            .insert(request_id.to_owned(), response.clone());
        response
    }

    fn stack(&self) -> (Vec<String>, bool) {
        let mut frames = [std::ptr::null_mut(); 64];
        unsafe {
            let count = libc::backtrace(frames.as_mut_ptr(), frames.len() as i32) as usize;
            let frames = &frames[..count];
            let normal_boundary = frames.windows(2).any(|pair| {
                pair[0] as usize == self.slide + 0x1022c50dc
                    && pair[1] as usize == self.slide + 0x102258564
            });
            let symbols = libc::backtrace_symbols(frames.as_ptr(), count as i32);
            let mut names = Vec::new();
            if !symbols.is_null() {
                for index in 0..count {
                    names.push(
                        CStr::from_ptr(*symbols.add(index))
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
                libc::free(symbols.cast());
            }
            (names, normal_boundary)
        }
    }
}

struct ProcessingGuard<'a>(&'a AtomicBool);

impl Drop for ProcessingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

extern "C" fn poll(_: *mut c_void) {
    let outcome = catch_unwind(|| {
        let Some(bridge) = BRIDGE.get() else {
            return;
        };
        let poll_ticks = bridge.poll_ticks.fetch_add(1, Ordering::Relaxed) + 1;
        if bridge.processing.swap(true, Ordering::Acquire) {
            return;
        }
        let _guard = ProcessingGuard(&bridge.processing);
        let request_path = bridge.directory.join("request.json");
        let Ok(request_bytes) = fs::read(&request_path) else {
            return;
        };
        if fs::remove_file(request_path).is_err() {
            return;
        }
        let Ok(request) = serde_json::from_slice::<Value>(&request_bytes) else {
            return;
        };
        let Some(request_id) = request["id"].as_str() else {
            return;
        };
        if request_id.is_empty()
            || !request_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return;
        }

        if request["probeSuppressBeforeDispatch"].as_bool() == Some(true) {
            let _ = bridge.write(
                &format!("withheld-{request_id}.json"),
                &json!({"request": request, "dispatched": false}),
            );
            return;
        }
        let response = bridge.process(&request, poll_ticks);
        if request["dropAcknowledgement"].as_bool() == Some(true) {
            let _ = bridge.write(&format!("suppressed-{request_id}.json"), &response);
            return;
        }
        let _ = bridge.write(&format!("response-{request_id}.json"), &response);
    });
    if outcome.is_err() {
        if let Some(bridge) = BRIDGE.get() {
            let _ = bridge.write(
                "bridge-panic.json",
                &json!({"error": "Rust callback panicked; action completion unknown"}),
            );
        }
    }
}

unsafe fn symbol_matches(name: &CStr, expected: usize, slide: usize) -> bool {
    libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) as usize == slide + expected
}

extern "C" fn initialize() {
    let _ = catch_unwind(|| {
        let Some(directory) = std::env::var_os("SDK_BRIDGE_DIR") else {
            return;
        };
        unsafe {
            for index in 0..platform::_dyld_image_count() {
                let header = &*platform::_dyld_get_image_header(index);
                if header.file_type != 2 {
                    continue;
                }
                let slide = platform::_dyld_get_image_vmaddr_slide(index) as usize;
                let supported = header.cpu_type == 0x0100000c
                    && symbol_matches(c"g_CurrentGameState", GAME_STATE_SYMBOL, slide)
                    && symbol_matches(c"g_CurrentInGameIdler", IN_GAME_IDLER_SYMBOL, slide)
                    && symbol_matches(
                        c"_ZN12CInGameIdler13JumpToNextDayEv",
                        JUMP_TO_NEXT_DAY_SYMBOL,
                        slide,
                    )
                    && symbol_matches(c"_Z21GetGameDateIfPossiblev", GET_GAME_DATE_SYMBOL, slide);
                let supported = supported
                    && symbol_matches(
                        c"_ZN5NUtil15FastForwardDaysEib",
                        FAST_FORWARD_DAYS_SYMBOL,
                        slide,
                    );
                let supported = supported
                    && symbol_matches(
                        c"_Z18AccessCheatManagerv",
                        ACCESS_CHEAT_MANAGER_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_Z18OnExecute_ToggleAIRK9CPdxArrayI7CStringiE",
                        TOGGLE_AI_SYMBOL,
                        slide,
                    );
                let supported = supported
                    && symbol_matches(
                        c"_ZNK16COpenPlayerEvent24PostEventOptionSelectionEi",
                        POST_EVENT_OPTION_SELECTION_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_ZNK12CEventOption11GetFirstKeyEv",
                        GET_EVENT_OPTION_KEY_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_ZNK16COpenPlayerEvent15IsObserverEventEv",
                        IS_OBSERVER_EVENT_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_ZN12CEventOption22IsOptionAtIndexAllowedERK11CEventScopebRK9CPdxArrayINSt3__110shared_ptrIS_EEiEi19EEventExecutionModePK16CPdxUnorderedMapI18EEffectUserDataKeyy8SPdxHashISC_vENS4_8equal_toISC_EELb0EE",
                        IS_OPTION_ALLOWED_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_ZN12CEventOption41FindMatchingPotentialExclusiveOptionIndexERK11CEventScopebRK9CPdxArrayINSt3__110shared_ptrIS_EEiE",
                        FIND_EXCLUSIVE_OPTION_SYMBOL,
                        slide,
                    )
                    && symbol_matches(
                        c"_ZNK12CEventOption26IsPotentialIgnoreExclusiveERK11CEventScopebb",
                        IS_POTENTIAL_IGNORE_EXCLUSIVE_SYMBOL,
                        slide,
                    );
                let supported = supported
                    && symbol_matches(c"_ZNK13CEventManager8GetEventEi", 0x1004d49e4, slide)
                    && symbol_matches(
                        c"_ZNK13CEventManager16GetIDInNameSpaceERK7CString",
                        0x1004daa48,
                        slide,
                    )
                    && symbol_matches(c"_ZN11CEventScopeC1Ev", 0x1004e6cf0, slide)
                    && symbol_matches(
                        c"_ZN21CScopeObjectReference10SetCountryEPK8CCountry",
                        0x1004e3848,
                        slide,
                    );
                let image = CStr::from_ptr(platform::_dyld_get_image_name(index)).to_string_lossy();
                let hooks = if supported {
                    hooks::install(slide)
                } else {
                    Err("unsupported build".into())
                };
                let supported = supported && hooks.is_ok();
                let bridge = Bridge {
                    directory: PathBuf::from(directory),
                    run: std::env::var("SDK_BRIDGE_RUN").unwrap_or_default(),
                    slide,
                    supported,
                    processing: AtomicBool::new(false),
                    poll_ticks: AtomicU64::new(0),
                    completed_requests: Mutex::new(HashMap::new()),
                };
                let _ = bridge.write(
                    "bridge-load.json",
                    &json!({
                        "hooks": format!("{hooks:?}"),
                        "language": "rust",
                        "pid": std::process::id(),
                        "mainThread": platform::pthread_main_np() != 0,
                        "cpuType": header.cpu_type,
                        "imageSlide": slide,
                        "image": image,
                        "supported": supported,
                    }),
                );
                if BRIDGE.set(bridge).is_err() {
                    return;
                }
                let timer = platform::dispatch_source_create(
                    &platform::_dispatch_source_type_timer,
                    0,
                    0,
                    &platform::_dispatch_main_q,
                );
                if timer.is_null() {
                    return;
                }
                platform::dispatch_source_set_event_handler_f(timer, poll);
                platform::dispatch_source_set_timer(
                    timer,
                    platform::dispatch_time(0, 1_000_000_000),
                    100_000_000,
                    5_000_000,
                );
                platform::dispatch_resume(timer);
                break;
            }
        }
    });
}

#[used]
#[link_section = "__DATA,__mod_init_func"]
static INITIALIZER: extern "C" fn() = initialize;

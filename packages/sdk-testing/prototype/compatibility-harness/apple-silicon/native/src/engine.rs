//! Exact-build native invocation helpers for this disposable bridge.
use serde_json::{json, Value};
use std::{mem, ptr};

const SAVE_GAME: usize = 0x100878aec;
const CONSTRUCT_STRING: usize = 0x10251e940;
const DESTROY_CSTRING: usize = 0x10000b5a0;
const CURRENT_GAME_STATE: usize = 0x1032e53c0;
const CURRENT_IN_GAME_IDLER: usize = 0x1032e53a8;
const GET_GAME_DATE: usize = 0x100708360;
const GAME_DATE_STRING: usize = 0x1006fb1a4;
const DESTROY_STRING: usize = 0x10000b5a0;
const ACCESS_LOCAL_HUMAN: usize = 0x100715a40;
const JUMP_TO_NEXT_DAY: usize = 0x1008790c8;
const FAST_FORWARD_DAYS: usize = 0x1006f0a10;
const ACCESS_CHEAT_MANAGER: usize = 0x1001079e8;
const TOGGLE_AI: usize = 0x101338534;
const GLOBAL_AI_ENABLED_OFFSET: usize = 0x72;
const GET_EVENT_OPTION_KEY: usize = 0x1004de4e0;
const IS_OBSERVER_EVENT: usize = 0x1004b749c;
const IS_OPTION_ALLOWED: usize = 0x1004dd308;
const FIND_EXCLUSIVE_OPTION: usize = 0x1004df8bc;
const IS_POTENTIAL_IGNORE_EXCLUSIVE: usize = 0x1004de97c;
const POST_EVENT_OPTION_SELECTION: usize = 0x1004b78ac;

std::arch::global_asm!(
    ".text",
    ".p2align 2",
    ".globl _bridge_structure_return",
    "_bridge_structure_return:",
    "mov x8, x2",
    "br x1",
);

extern "C" {
    fn bridge_structure_return(object: *const u8, function: usize, output: *mut u8);
}

#[repr(align(16))]
struct StringBuffer([u8; 64]);

unsafe fn pointer(base: *const u8, offset: usize) -> *const u8 {
    ptr::read(base.add(offset).cast())
}

unsafe fn integer(base: *const u8, offset: usize) -> i32 {
    ptr::read(base.add(offset).cast())
}

unsafe fn game_string(value: *const u8) -> Result<String, &'static str> {
    let bytes = if ptr::read(value.add(23).cast::<i8>()) < 0 {
        pointer(value, 0)
    } else {
        value
    };
    if bytes.is_null() {
        return Err("null-string");
    }
    let length = libc::strnlen(bytes.cast(), 256);
    if length == 256 {
        return Err("overlong-string");
    }
    std::str::from_utf8(std::slice::from_raw_parts(bytes, length))
        .map(str::to_owned)
        .map_err(|_| "invalid-utf8")
}

unsafe fn state(slide: usize) -> *const u8 {
    ptr::read((slide + CURRENT_GAME_STATE) as *const *const u8)
}

unsafe fn idler(slide: usize) -> *const u8 {
    ptr::read((slide + CURRENT_IN_GAME_IDLER) as *const *const u8)
}

unsafe fn local_country(slide: usize, state: *const u8) -> i32 {
    let access: unsafe extern "C" fn(*const u8) -> *const u8 =
        mem::transmute(slide + ACCESS_LOCAL_HUMAN);
    integer(access(state), 0x54)
}

pub(crate) unsafe fn current_date(slide: usize) -> i32 {
    let mut date = 0i32;
    bridge_structure_return(
        ptr::null(),
        slide + GET_GAME_DATE,
        (&mut date as *mut i32).cast(),
    );
    date
}

unsafe fn global_ai_enabled(slide: usize) -> Result<bool, &'static str> {
    let access: unsafe extern "C" fn() -> *const u8 = mem::transmute(slide + ACCESS_CHEAT_MANAGER);
    let manager = access();
    if manager.is_null() {
        return Err("cheat-manager-unavailable");
    }
    match ptr::read(manager.add(GLOBAL_AI_ENABLED_OFFSET)) {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err("invalid-global-ai-state"),
    }
}

unsafe fn toggle_global_ai(slide: usize) -> Result<String, &'static str> {
    let mut output = StringBuffer([0; 64]);
    bridge_structure_return(ptr::null(), slide + TOGGLE_AI, output.0.as_mut_ptr());
    if ptr::read(output.0.as_ptr()) == 0 {
        return Err("ai-command-rejected");
    }
    let result_string = output.0.as_mut_ptr().add(8);
    let value = game_string(result_string);
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + DESTROY_STRING);
    destroy(result_string);
    value
}

unsafe fn format_date(slide: usize, date: i32) -> Result<String, &'static str> {
    let mut output = StringBuffer([0; 64]);
    bridge_structure_return(
        (&date as *const i32).cast(),
        slide + GAME_DATE_STRING,
        output.0.as_mut_ptr(),
    );
    let value = game_string(output.0.as_ptr());
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + DESTROY_STRING);
    destroy(output.0.as_mut_ptr());
    value
}

unsafe fn option_key(slide: usize, option: *const u8) -> Result<String, &'static str> {
    let mut output = StringBuffer([0; 64]);
    bridge_structure_return(option, slide + GET_EVENT_OPTION_KEY, output.0.as_mut_ptr());
    let key = game_string(output.0.as_ptr());
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + DESTROY_STRING);
    destroy(output.0.as_mut_ptr());
    key
}

unsafe fn observer_event(slide: usize, pending: *const u8) -> bool {
    let query: unsafe extern "C" fn(*const u8) -> bool = mem::transmute(slide + IS_OBSERVER_EVENT);
    query(pending)
}

unsafe fn option_allowed(slide: usize, pending: *const u8, event: *const u8, index: i32) -> bool {
    let query: unsafe extern "C" fn(*const u8, bool, *const u8, i32, i32, *const u8) -> bool =
        mem::transmute(slide + IS_OPTION_ALLOWED);
    query(
        pending.add(0x10),
        true,
        event.add(0x578),
        index,
        0,
        ptr::null(),
    )
}

unsafe fn option_visible(
    slide: usize,
    pending: *const u8,
    event: *const u8,
    option: *const u8,
    index: i32,
) -> bool {
    let exclusive: unsafe extern "C" fn(*const u8, bool, *const u8) -> i32 =
        mem::transmute(slide + FIND_EXCLUSIVE_OPTION);
    let matched = exclusive(pending.add(0x10), true, event.add(0x578));
    if matched >= 0 {
        return index == matched;
    }
    let potential: unsafe extern "C" fn(*const u8, *const u8, bool, bool) -> bool =
        mem::transmute(slide + IS_POTENTIAL_IGNORE_EXCLUSIVE);
    potential(option, pending.add(0x10), true, true)
}

unsafe fn checked_count(base: *const u8, offset: usize) -> Result<usize, &'static str> {
    let value = integer(base, offset);
    if !(0..=64).contains(&value) {
        return Err("unexpected-array-count");
    }
    Ok(value as usize)
}

unsafe fn pending_events(slide: usize, state: *const u8) -> Result<Value, &'static str> {
    let total = checked_count(state, 0x17c)?;
    let events = pointer(state, 0x170);
    let mut result = Vec::new();
    for event_index in 0..total {
        let pending = pointer(events, event_index * 8);
        let event = pointer(pointer(pending, 8), 0);
        let option_count = checked_count(event, 0x58c)?;
        let options = pointer(event, 0x580);
        let mut rows = Vec::new();
        for option_index in 0..option_count {
            let option = pointer(options, option_index * 16);
            rows.push(json!({
                "index": option_index,
                "key": option_key(slide, option)?,
                "visible": option_visible(slide, pending, event, option, option_index as i32),
                "allowed": option_allowed(slide, pending, event, option_index as i32),
            }));
        }
        result.push(json!({
            "scopeFromId": integer(pointer(pending.add(0x10),0x38),0x10),
            "scopeFromType": ptr::read(pointer(pending.add(0x10),0x38).add(8).cast::<u64>()),
            "pendingId": integer(pending, 0x180),
            "countryId": integer(pending, 0x184),
            "eventId": game_string(event.add(0x10))?,
            "eventNumericId": integer(event, 8),
            "selected": ptr::read(pending.add(0x190)) != 0,
            "localCountryId": local_country(slide, state),
            "observer": observer_event(slide, pending),
            "optionCount": option_count,
            "options": rows,
        }));
    }
    Ok(json!(result))
}

unsafe fn pending_event_ids(state: *const u8) -> Result<Vec<String>, &'static str> {
    let count = integer(state, 0x17c);
    if !(0..=64).contains(&count) {
        return Err("unexpected-open-event-count");
    }
    let events = pointer(state, 0x170);
    let mut ids = Vec::new();
    for index in 0..count as usize {
        let pending = pointer(events, index * 8);
        let event = pointer(pointer(pending, 8), 0);
        ids.push(game_string(event.add(0x10))?);
    }
    Ok(ids)
}

pub unsafe fn snapshot(slide: usize) -> Result<Value, &'static str> {
    let idler = idler(slide);
    let state = state(slide);
    let ready = !state.is_null() && ptr::read(state.add(0x98)) != 0;
    let mut snapshot = json!({
        "inGameIdlerAvailable": !idler.is_null(),
        "gameStateAvailable": !state.is_null(),
        "gameStateReady": ready,
    });

    if !idler.is_null() {
        snapshot["paused"] = json!(ptr::read(idler.add(0x584)) != 0);
        snapshot["speed"] = json!(integer(idler, 0x580));
        snapshot["advanceInProgress"] = json!(ptr::read(idler.add(0x5b9)) != 0);
        snapshot["savedSpeed"] = json!(integer(idler, 0x5bc));
    }
    if ready {
        let date = current_date(slide);
        snapshot["dateRaw"] = json!(date);
        snapshot["date"] = json!(format_date(slide, date)?);
        snapshot["localCountryId"] = json!(local_country(slide, state));
        snapshot["playerSubject"] = crate::locators::inspect(slide)["player"]["subject"].clone();
        snapshot["pendingEventIds"] = json!(pending_event_ids(state)?);
        snapshot["pendingEvents"] = pending_events(slide, state)?;
        snapshot["liveCountryIds"] = json!((0..256)
            .filter(|id| resolve_country(slide, *id).is_some())
            .collect::<Vec<_>>());
    }
    snapshot["globalAIEnabled"] = match global_ai_enabled(slide) {
        Ok(value) => json!(value),
        Err(reason) => json!({"available": false, "reason": reason}),
    };
    Ok(snapshot)
}

pub unsafe fn select_event(slide: usize, request: &Value, before: &Value) -> Value {
    if before["inGameIdlerAvailable"].as_bool() != Some(true) {
        return json!({"status": "no-in-game-idler"});
    }
    if before["gameStateAvailable"].as_bool() != Some(true)
        || before["gameStateReady"].as_bool() != Some(true)
    {
        return json!({"status": "game-state-not-ready"});
    }
    if before["paused"].as_bool() != Some(true) {
        return json!({"status": "not-paused"});
    }
    if before["advanceInProgress"].as_bool() == Some(true) {
        return json!({"status": "advance-in-progress"});
    }
    if request["expectedDate"].as_str() != before["date"].as_str() {
        return json!({"status": "date-mismatch"});
    }

    let Some(expected_id) = request["pendingId"].as_i64() else {
        return json!({"status": "missing-pending-id"});
    };
    let Some(expected_country) = request["countryId"].as_i64() else {
        return json!({"status": "missing-country-id"});
    };
    let Some(expected_event) = request["eventId"].as_str() else {
        return json!({"status": "missing-event-id"});
    };
    let Some(expected_key) = request["optionKey"].as_str() else {
        return json!({"status": "missing-option-key"});
    };
    let state = state(slide);
    let total = match checked_count(state, 0x17c) {
        Ok(value) => value,
        Err(reason) => return json!({"status": reason}),
    };
    let events = pointer(state, 0x170);
    let mut pending = ptr::null();
    for index in 0..total {
        let candidate = pointer(events, index * 8);
        if i64::from(integer(candidate, 0x180)) == expected_id {
            pending = candidate;
        }
    }
    if pending.is_null() || ptr::read(pending.add(0x190)) != 0 {
        return json!({"status": "stale-pending-event"});
    }
    let event = pointer(pointer(pending, 8), 0);
    let actual_event = match game_string(event.add(0x10)) {
        Ok(value) => value,
        Err(reason) => return json!({"status": reason}),
    };
    if actual_event != expected_event {
        return json!({"status": "wrong-event"});
    }
    let country = integer(pending, 0x184);
    if i64::from(country) != expected_country || country != local_country(slide, state) {
        return json!({"status": "wrong-country"});
    }
    if observer_event(slide, pending) {
        return json!({"status": "observer-event"});
    }
    let option_count = match checked_count(event, 0x58c) {
        Ok(value) => value,
        Err(reason) => return json!({"status": reason}),
    };
    if option_count == 0 {
        return json!({"status":"event-has-no-choice"});
    }
    let options = pointer(event, 0x580);
    let mut selected_index = None;
    for index in 0..option_count {
        let key = match option_key(slide, pointer(options, index * 16)) {
            Ok(value) => value,
            Err(reason) => return json!({"status": reason}),
        };
        if key == expected_key {
            if selected_index.is_some() {
                return json!({"status": "ambiguous-option-key"});
            }
            selected_index = Some(index);
        }
    }
    let Some(selected_index) = selected_index else {
        return json!({"status": "nonexistent-option"});
    };
    let option = pointer(options, selected_index * 16);
    if !option_visible(slide, pending, event, option, selected_index as i32) {
        return json!({"status": "hidden-option"});
    }
    if !option_allowed(slide, pending, event, selected_index as i32) {
        return json!({"status": "disabled-option"});
    }
    let post: unsafe extern "C" fn(*const u8, i32) =
        mem::transmute(slide + POST_EVENT_OPTION_SELECTION);
    post(pending, selected_index as i32);
    json!({
        "status": "selection-posted",
        "pendingId": expected_id,
        "countryId": country,
        "eventId": actual_event,
        "optionKey": expected_key,
        "sourceIndex": selected_index,
    })
}

pub unsafe fn establish_ai(slide: usize, request: &Value, before: &Value) -> Value {
    if before["inGameIdlerAvailable"].as_bool() != Some(true) {
        return json!({"status": "no-in-game-idler"});
    }
    if before["gameStateAvailable"].as_bool() != Some(true) {
        return json!({"status": "no-game-state"});
    }
    if before["gameStateReady"].as_bool() != Some(true) {
        return json!({"status": "game-state-not-ready"});
    }
    if before["paused"].as_bool() != Some(true) {
        return json!({"status": "not-paused"});
    }
    if before["advanceInProgress"].as_bool() == Some(true) {
        return json!({"status": "advance-in-progress"});
    }
    if request["expectedDate"].as_str() != before["date"].as_str() {
        return json!({"status": "date-mismatch"});
    }
    let Some(desired) = request["desiredAIEnabled"].as_bool() else {
        return json!({"status": "invalid-desired-ai-state"});
    };
    let Some(observed_before) = before["globalAIEnabled"].as_bool() else {
        return json!({"status": "global-ai-state-unavailable"});
    };
    if let Some(expected) = request["expectedAIEnabled"].as_bool() {
        if expected != observed_before {
            return json!({
                "status": "ai-state-mismatch",
                "observedBefore": observed_before,
            });
        }
    }

    let requested_toggle_count = request["probeToggleCount"].as_u64();
    let toggle_count = requested_toggle_count.unwrap_or(u64::from(observed_before != desired));
    if toggle_count > 2 {
        return json!({"status": "invalid-probe-toggle-count"});
    }
    let mut command_results = Vec::new();
    for _ in 0..toggle_count {
        match toggle_global_ai(slide) {
            Ok(result) => command_results.push(result),
            Err(reason) => {
                return json!({
                    "status": "ai-command-error",
                    "observedBefore": observed_before,
                    "toggleCount": command_results.len(),
                    "commandResults": command_results,
                    "error": reason,
                });
            }
        }
    }
    let observed_after = match global_ai_enabled(slide) {
        Ok(value) => value,
        Err(reason) => {
            return json!({
                "status": "global-ai-readback-unavailable",
                "observedBefore": observed_before,
                "toggleCount": toggle_count,
                "commandResults": command_results,
                "error": reason,
            });
        }
    };
    json!({
        "status": if observed_after == desired {
            if toggle_count == 0 { "ai-already-established" } else { "ai-established" }
        } else {
            "ai-not-established"
        },
        "requested": desired,
        "observedBefore": observed_before,
        "toggleCount": toggle_count,
        "commandAccepted": toggle_count > 0,
        "commandResults": command_results,
        "observedAfter": observed_after,
        "established": observed_after == desired,
        "probeFaultInjected": requested_toggle_count.is_some(),
    })
}

pub unsafe fn advance_one_day(slide: usize, request: &Value, before: &Value) -> &'static str {
    if before["inGameIdlerAvailable"].as_bool() != Some(true) {
        return "no-in-game-idler";
    }
    if before["gameStateAvailable"].as_bool() != Some(true) {
        return "no-game-state";
    }
    if before["gameStateReady"].as_bool() != Some(true) {
        return "game-state-not-ready";
    }
    if before["paused"].as_bool() != Some(true) {
        return "not-paused";
    }
    if before["advanceInProgress"].as_bool() == Some(true) {
        return "advance-in-progress";
    }
    if request["expectedDate"].as_str() != before["date"].as_str() {
        return "date-mismatch";
    }

    let jump: unsafe extern "C" fn(*const u8) = mem::transmute(slide + JUMP_TO_NEXT_DAY);
    jump(idler(slide));
    "advance-accepted"
}

pub unsafe fn fast_forward(slide: usize, request: &Value, before: &Value) -> &'static str {
    if before["inGameIdlerAvailable"].as_bool() != Some(true) {
        return "no-in-game-idler";
    }
    if before["gameStateAvailable"].as_bool() != Some(true) {
        return "no-game-state";
    }
    if before["gameStateReady"].as_bool() != Some(true) {
        return "game-state-not-ready";
    }
    if before["paused"].as_bool() != Some(true) {
        return "not-paused";
    }
    if before["advanceInProgress"].as_bool() == Some(true) {
        return "advance-in-progress";
    }
    if request["expectedDate"].as_str() != before["date"].as_str() {
        return "date-mismatch";
    }
    let Some(days) = request["days"].as_i64() else {
        return "invalid-day-count";
    };
    if !(1..=120).contains(&days) {
        return "invalid-day-count";
    }

    let run: unsafe extern "C" fn(i32, bool) = mem::transmute(slide + FAST_FORWARD_DAYS);
    run(days as i32, false);
    "fast-forward-completed"
}

// Private offsets are pinned by executable hash and the retained disassembly.
#[repr(align(16))]
struct ScopeBuffer([u8; 0x180]);

pub unsafe fn fire_event(slide: usize, request: &Value, before: &Value) -> Value {
    if before["gameStateReady"] != true || before["inGameIdlerAvailable"] != true {
        return json!({"status": "game-state-not-ready"});
    }
    if before["paused"] != true || before["advanceInProgress"] != false {
        return json!({"status": "not-paused"});
    }
    if request["expectedDate"] != before["date"] {
        return json!({"status": "date-mismatch"});
    }
    if request["countryId"].as_i64() != before["localCountryId"].as_i64() {
        return json!({"status": "unsupported-country"});
    }
    let Some(event_id) = request["eventId"].as_str() else {
        return json!({"status": "missing-event-id"});
    };
    let EventDefinition {
        manager,
        handle,
        numeric_id,
        definition,
    } = match resolve_definition(slide, event_id) {
        Ok(definition) => definition,
        Err(reason) => return json!({"status":reason}),
    };
    if ptr::read(definition.add(0x68).cast::<u64>()) != 4 {
        return json!({"status":"unsupported-event-kind"});
    }
    let from = if request["fromCountryId"].is_null() {
        None
    } else {
        let Some(id) = request["fromCountryId"]
            .as_i64()
            .and_then(|id| i32::try_from(id).ok())
        else {
            return json!({"status":"invalid-from"});
        };
        match resolve_country(slide, id) {
            Some(country) => Some(country),
            None => return json!({"status":"invalid-from"}),
        }
    };
    let scope_ctor: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x1004e6cf0);
    let scope_dtor: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x100040c6c);
    let set_country: unsafe extern "C" fn(*mut u8, *const u8) = mem::transmute(slide + 0x1004e3848);
    let access_player: unsafe extern "C" fn(*const u8) -> *const u8 =
        mem::transmute(slide + 0x100741f60);
    let player = access_player(state(slide));
    let mut scope = ScopeBuffer([0; 0x180]);
    let mut from_scope = ScopeBuffer([0; 0x180]);
    scope_ctor(scope.0.as_mut_ptr());
    scope_ctor(from_scope.0.as_mut_ptr());
    set_country(scope.0.as_mut_ptr(), player);
    set_country(from_scope.0.as_mut_ptr(), from.unwrap_or(player));
    if !request["fromCountryId"].is_null() {
        // +0x38 is the borrowed FROM link. Pending construction copies internal scopes.
        ptr::write(
            scope.0.as_mut_ptr().add(0x38).cast::<*const u8>(),
            from_scope.0.as_ptr(),
        );
    }
    let scope_evidence = json!({
        "nativeAddress": scope.0.as_ptr() as usize,
        "rootType": ptr::read(scope.0.as_ptr().add(8).cast::<u64>()),
        "rootId": integer(scope.0.as_ptr(), 0x10),
        "fromType": ptr::read(pointer(scope.0.as_ptr(), 0x38).add(8).cast::<u64>()),
        "fromId": integer(pointer(scope.0.as_ptr(), 0x38), 0x10),
        "explicitFrom": !request["fromCountryId"].is_null(),
    });
    let scope_ok: unsafe extern "C" fn(*const u8, *mut u8) -> bool =
        mem::transmute(slide + 0x1004bb8e0);
    let check_scope: unsafe extern "C" fn(*const u8, *const u8, *const u8) -> bool =
        mem::transmute(slide + 0x1004d98e0);
    if !scope_ok(definition, scope.0.as_mut_ptr())
        || !check_scope(manager, definition, scope.0.as_ptr())
    {
        scope_dtor(scope.0.as_mut_ptr());
        scope_dtor(from_scope.0.as_mut_ptr());
        return json!({"status":"invalid-event-context"});
    }
    let counter_before = integer(state(slide), 0x160);
    let trigger: unsafe extern "C" fn(*const u8, *const u8, *mut u8, bool, i32, *const u8) =
        mem::transmute(slide + 0x1004d82b0);
    crate::hooks::begin();
    trigger(manager, handle, scope.0.as_mut_ptr(), true, 0, ptr::null());
    let trace = crate::hooks::finish();
    let counter_after = integer(state(slide), 0x160);
    scope_dtor(scope.0.as_mut_ptr());
    scope_dtor(from_scope.0.as_mut_ptr());
    let after = match snapshot(slide) {
        Ok(value) => value,
        Err(reason) => return json!({"status": "fire-completion-unknown", "reason": reason}),
    };
    let old_ids: Vec<_> = before["pendingEvents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["pendingId"].clone())
        .collect();
    let created: Vec<_> = after["pendingEvents"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| !old_ids.contains(&event["pendingId"]))
        .cloned()
        .collect();
    let mut outcome = json!({"nativeCallReturned":true,"numericId":numeric_id,"nativeHandleAddress":handle as usize,
        "scope":scope_evidence,"counterBefore":counter_before,"counterAfter":counter_after,"created":created,"trace":trace});
    if request["probeDiscardIdentity"].as_bool() == Some(true) {
        outcome["status"] = json!("fire-correlation-ambiguous");
        return outcome;
    }
    if after["dateRaw"] != before["dateRaw"] || after["paused"] != true || trace["balanced"] != true
    {
        outcome["status"] = json!("fire-completion-unknown");
        return outcome;
    }
    let Some(outer) = trace["frames"].as_array().and_then(|frames| frames.first()) else {
        outcome["status"] = json!("fire-completion-unknown");
        return outcome;
    };
    if !outer["parent"].is_null()
        || outer["handle"] != json!(handle as usize)
        || outer["scope"] != scope_evidence["nativeAddress"]
        || outer["returned"] != true
        || outer["immediateReturned"] != true
    {
        outcome["status"] = json!("fire-completion-unknown");
        return outcome;
    }
    let pending = outer["pending"].as_array().unwrap();
    let pending_id = match pending.as_slice() {
        [] if outer["afterReturned"] == true => None,
        [entry]
            if entry["handle"] == outer["handle"]
                && entry["scope"] == outer["scope"]
                && entry["insertionReturned"] == true =>
        {
            let found = after["pendingEvents"]
                .as_array()
                .unwrap()
                .iter()
                .find(|event| event["pendingId"] == entry["id"]);
            match found {
                Some(event)
                    if event["eventId"] == event_id
                        && event["countryId"] == request["countryId"]
                        && event["selected"] == false =>
                {
                    Some(entry["id"].clone())
                }
                _ => {
                    outcome["status"] = json!("fire-completion-unknown");
                    return outcome;
                }
            }
        }
        _ => {
            outcome["status"] = json!("fire-completion-unknown");
            return outcome;
        }
    };
    outcome["status"] = json!("fire-completed");
    outcome["handle"] = json!({"eventId":event_id,"countryId":request["countryId"],"fromCountryId":request["fromCountryId"],
        "pendingId":pending_id,"kind":if pending_id.is_some(){"pending"}else{"completed"}});
    outcome
}

/// Resolve a full native country reference, including its generation bits.
unsafe fn resolve_country(slide: usize, id: i32) -> Option<*const u8> {
    let database = ptr::read((slide + 0x103299f00) as *const *const u8);
    if database.is_null() {
        return None;
    }
    let index = (id as u32 & 0xffffff) as usize;
    let count = integer(database, 0x20);
    if count < 0 || index >= count as usize {
        return None;
    }
    let country = pointer(pointer(database, 0x18), index * 16 + 8);
    if country.is_null() || integer(country, 0x20) != id {
        return None;
    }
    let valid: unsafe extern "C" fn(*const u8) -> bool =
        mem::transmute(pointer(pointer(country, 0), 0x58));
    valid(country).then_some(country)
}

pub unsafe fn save_game(slide: usize, request: &Value, before: &Value) -> &'static str {
    if before["inGameIdlerAvailable"].as_bool() != Some(true) {
        return "no-in-game-idler";
    }
    if before["gameStateReady"].as_bool() != Some(true) {
        return "game-state-not-ready";
    }
    if before["paused"].as_bool() != Some(true) {
        return "not-paused";
    }
    if before["advanceInProgress"].as_bool() == Some(true) {
        return "advance-in-progress";
    }
    let Some(name) = request["name"].as_str() else {
        return "missing-save-name";
    };
    if name.is_empty()
        || name.len() > 80
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return "invalid-save-name";
    }
    let Ok(name) = std::ffi::CString::new(name) else {
        return "invalid-save-name";
    };
    let mut game_name = StringBuffer([0; 64]);
    let construct: unsafe extern "C" fn(*mut u8, *const libc::c_char) =
        mem::transmute(slide + CONSTRUCT_STRING);
    construct(game_name.0.as_mut_ptr(), name.as_ptr());
    let save: unsafe extern "C" fn(*const u8, *const u8, bool, bool) =
        mem::transmute(slide + SAVE_GAME);
    save(idler(slide), game_name.0.as_ptr(), false, false);
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + DESTROY_CSTRING);
    destroy(game_name.0.as_mut_ptr());
    "save-accepted"
}

/// Resolved definition and invocation handles, valid only in the current native process.
pub(crate) struct EventDefinition {
    manager: *const u8,
    handle: *const u8,
    numeric_id: i32,
    /// Engine-owned parsed definition used for condition evaluation.
    pub(crate) definition: *const u8,
}

/// Find an exact named event without firing it; reject missing or mismatched definitions.
pub(crate) unsafe fn resolve_definition(
    slide: usize,
    event_id: &str,
) -> Result<EventDefinition, &'static str> {
    let manager = ptr::read((slide + 0x1032e4fb0) as *const *const u8);
    if manager.is_null() {
        return Err("no-event-manager");
    }
    let name = std::ffi::CString::new(event_id).map_err(|_| "invalid-event-id")?;
    let mut string = StringBuffer([0; 64]);
    let construct: unsafe extern "C" fn(*mut u8, *const libc::c_char) =
        mem::transmute(slide + CONSTRUCT_STRING);
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + DESTROY_STRING);
    construct(string.0.as_mut_ptr(), name.as_ptr());
    let resolve: unsafe extern "C" fn(*const u8, *const u8) -> i32 =
        mem::transmute(slide + 0x1004daa48);
    let get: unsafe extern "C" fn(*const u8, i32) -> *const u8 =
        mem::transmute(slide + 0x1004d49e4);
    let numeric_id = resolve(manager, string.0.as_ptr());
    let handle = get(manager, numeric_id);
    destroy(string.0.as_mut_ptr());
    if handle.is_null() {
        return Err("event-not-found");
    }
    let definition = pointer(handle, 0);
    if definition.is_null() {
        return Err("event-not-found");
    }
    if game_string(definition.add(0x10)).as_deref() != Ok(event_id) {
        return Err("definition-identity-mismatch");
    }
    Ok(EventDefinition {
        manager,
        handle,
        numeric_id,
        definition,
    })
}

//! Frozen script dispatch and synchronous invocation-scoped marker capture for this probe.
use serde_json::{json, Value};
use std::{cell::RefCell, mem, ptr, sync::OnceLock};
static CATALOGUE: OnceLock<Value> = OnceLock::new();
thread_local! { static ACTIVE: RefCell<Option<(Value, Vec<Value>)>> = const { RefCell::new(None) }; }

/// Load the prepared catalogue once, before any game execution.
pub fn load() -> Result<(), String> {
    let path = std::env::var("SDK447_CATALOGUE").map_err(|e| e.to_string())?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    CATALOGUE
        .set(serde_json::from_slice(&bytes).map_err(|e| e.to_string())?)
        .map_err(|_| "already loaded".into())
}

/// Retain the exact static log token while the native effect is executing on this thread.
pub unsafe fn marker(effect: *const u8, scope: *mut u8) {
    ACTIVE.with(|active| {
        let mut active = active.borrow_mut();
        let Some((identity, records)) = active.as_mut() else {
            return;
        };
        let value = effect.add(0xa8);
        let bytes = if ptr::read(value.add(23).cast::<i8>()) < 0 {
            ptr::read(value.cast::<*const u8>())
        } else {
            value
        };
        let length = libc::strnlen(bytes.cast(), 512);
        let token = String::from_utf8_lossy(std::slice::from_raw_parts(bytes, length));
        if !token.starts_with("SDK446:") {
            return;
        }
        let mut record = identity.clone();
        record["token"] = json!(token);
        record["effectAddress"] = json!(effect as usize);
        record["scopeAddress"] = json!(scope as usize);
        record["sequence"] = json!(records.len());
        record["thread"] = json!(libc::pthread_self() as usize);
        records.push(record);
    });
}

#[repr(align(16))]
struct Scope([u8; 0x180]);

unsafe fn live_subject(
    slide: usize,
    request: &Value,
    world: &str,
    field: &str,
    kind: &str,
) -> Result<*const u8, Value> {
    let mut validation = request.clone();
    validation["binding"] = request[field].clone();
    let checked = crate::locators::validate(slide, &validation, world);
    if checked["status"] != "live-binding" {
        return Err(checked);
    }
    if request[field]["kind"] != kind {
        return Err(json!({"status":"wrong-kind"}));
    }
    Ok(checked["address"].as_u64().unwrap() as *const u8)
}

/// Execute only a frozen parsed immediate block with validated target and optional country FROM.
pub unsafe fn invoke(slide: usize, request: &Value, before: &Value, world: &str) -> Value {
    if before["paused"] != true || before["advanceInProgress"] != false {
        return json!({"status":"not-paused"});
    }
    if request["expectedDate"] != before["date"] {
        return json!({"status":"date-mismatch"});
    }
    let Some(script) = CATALOGUE
        .get()
        .and_then(|c| c["scripts"].as_array())
        .and_then(|scripts| scripts.iter().find(|s| s["id"] == request["scriptId"]))
    else {
        return json!({"status":"undeclared-script"});
    };
    let kind = script["kind"].as_str().unwrap();
    let target = match live_subject(slide, request, world, "binding", kind) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let from = if script["from"] == true {
        match live_subject(slide, request, world, "from", "country") {
            Ok(p) => Some(p),
            Err(e) => return e,
        }
    } else {
        if !request["from"].is_null() {
            return json!({"status":"unexpected-from"});
        }
        None
    };
    let definition = match crate::engine::resolve_definition(slide, script["id"].as_str().unwrap())
    {
        Ok(d) => d.definition,
        Err(e) => return json!({"status":e}),
    };
    let expected_scope = if kind == "country" { 4 } else { 2 };
    if ptr::read_unaligned(definition.add(0x68).cast::<u64>()) != expected_scope {
        return json!({"status":"wrong-script-kind"});
    }
    let construct: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x1004e6cf0);
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x100040c6c);
    let set_country: unsafe extern "C" fn(*mut u8, *const u8) = mem::transmute(slide + 0x1004e3848);
    let set_target: unsafe extern "C" fn(*mut u8, *const u8) = mem::transmute(
        slide
            + if kind == "country" {
                0x1004e3848
            } else {
                0x1004e3384
            },
    );
    let perform: unsafe extern "C" fn(*const u8, *mut u8, i32, *const u8) =
        mem::transmute(slide + 0x1004bbc68);
    let mut scope = Scope([0; 0x180]);
    let mut from_scope = Scope([0; 0x180]);
    construct(scope.0.as_mut_ptr());
    construct(from_scope.0.as_mut_ptr());
    set_target(scope.0.as_mut_ptr(), target);
    if let Some(from) = from {
        set_country(from_scope.0.as_mut_ptr(), from);
        ptr::write(
            scope.0.as_mut_ptr().add(0x38).cast::<*const u8>(),
            from_scope.0.as_ptr(),
        );
    }
    let identity = json!({"invocation":request["invocation"],"invocationId":request["id"],"run":request["run"],"world":world,"suite":request["suite"],"phase":request["phase"],"scriptId":script["id"],"scriptDigest":script["digest"]});
    let acceptance = json!({"status":"native-accepted","identity":identity,"subject":request["binding"],"from":request["from"],"state":before});
    let accepted = crate::BRIDGE
        .get()
        .unwrap()
        .write(
            &format!("accepted-{}.json", request["id"].as_str().unwrap()),
            &acceptance,
        )
        .is_ok();
    if !accepted {
        destroy(scope.0.as_mut_ptr());
        destroy(from_scope.0.as_mut_ptr());
        return json!({"status":"acceptance-evidence-failed"});
    }
    ACTIVE.with(|a| *a.borrow_mut() = Some((identity.clone(), Vec::new())));
    let condition = script["operation"] == "condition";
    let observed = if condition {
        let evaluate: unsafe extern "C" fn(*const u8, *mut u8) -> bool =
            mem::transmute(slide + 0x1004bb600);
        condition_marker("start", scope.0.as_mut_ptr());
        let value = evaluate(definition, scope.0.as_mut_ptr());
        condition_marker(
            if value { "result:true" } else { "result:false" },
            scope.0.as_mut_ptr(),
        );
        condition_marker("end", scope.0.as_mut_ptr());
        Some(value)
    } else {
        perform(definition, scope.0.as_mut_ptr(), 0, ptr::null());
        None
    };
    let mut records = ACTIVE.with(|a| a.borrow_mut().take().unwrap().1);
    let fault = std::env::var("SDK447_FAULT").unwrap_or_default();
    if fault == "missing-end" {
        records.pop();
    }
    if fault == "stale-invocation" {
        if let Some(record) = records.first_mut() {
            record["invocation"]["id"] = json!("stale");
        }
    }
    destroy(scope.0.as_mut_ptr());
    destroy(from_scope.0.as_mut_ptr());
    let tokens: Vec<&str> = records
        .iter()
        .map(|r| r["token"].as_str().unwrap())
        .collect();
    let prefix = format!("SDK446:{}:", script["id"].as_str().unwrap());
    let expected = if let Some(value) = observed {
        vec![
            "start".to_string(),
            format!("result:{value}"),
            "end".to_string(),
        ]
    } else {
        vec![format!("{prefix}start"), format!("{prefix}end")]
    };
    let valid = tokens == expected;
    json!({"status":if valid {"script-completed"} else {"script-incomplete"},"nativeAccepted":true,"nativeReturned":true,"identity":identity,"markers":records,"subject":request["binding"],"conditionValue":observed,"injectedFault":fault,"nativePredicate":if condition {json!("CEvent::IsValid")} else {Value::Null}})
}

/// Read one resolved stockpile once; errors create no observation.
pub unsafe fn read(slide: usize, request: &Value, before: &Value, world: &str) -> Value {
    if before["paused"] != true {
        return json!({"status":"not-paused"});
    }
    let country = match live_subject(slide, request, world, "binding", "country") {
        Ok(p) => p,
        Err(e) => return e,
    };
    let key = request["resource"].as_str().unwrap_or_default();
    let resource = match resolve_resource(slide, key) {
        Ok(p) => p,
        Err(e) => return json!({"status":e}),
    };
    let module = ptr::read_unaligned(country.add(0x2a28).cast::<*const u8>());
    if module.is_null() {
        return json!({"status":"country-economy-unavailable"});
    }
    let vtable = ptr::read(module.cast::<*const u8>());
    let valid: unsafe extern "C" fn(*const u8) -> bool =
        mem::transmute(ptr::read(vtable.add(0x88).cast::<usize>()));
    if !valid(module) {
        return json!({"status":"country-economy-unavailable"});
    }
    let maximum: unsafe extern "C" fn() -> i32 = mem::transmute(slide + 0x101d1448c);
    let resource_id = ptr::read_unaligned(resource.add(0x18).cast::<i32>());
    let slots = maximum();
    if slots <= 0 || slots > 4096 || resource_id < 0 || resource_id >= slots {
        return json!({"status":"resource-slot-unavailable","resourceId":resource_id,"slots":slots});
    }
    let read: unsafe extern "C" fn(*const u8, *const u8) -> i64 =
        mem::transmute(slide + 0x10024e840);
    let start = crate::unix_time_millis();
    let date_before = crate::engine::current_date(slide);
    let coefficient = read(country, resource).to_string();
    let date_after = crate::engine::current_date(slide);
    let end = crate::unix_time_millis();
    json!({"status":"read-completed","observation":{"coefficient":coefficient,"economyModule":module as usize,"resourceSlots":slots,"scale":"100000","captureId":request["id"],"subject":request["binding"],"resource":key,"resourceId":ptr::read_unaligned(resource.add(0x18).cast::<u32>()),"world":world,"suite":request["suite"],"phase":request["phase"],"reader":"CCountry::GetResource","sampleStartUnixMs":start,"sampleEndUnixMs":end,"dateRawBefore":date_before,"dateRawAfter":date_after,"atomicSnapshotPromised":false}})
}
unsafe fn resolve_resource(slide: usize, key: &str) -> Result<*const u8, &'static str> {
    let database = ptr::read((slide + 0x1032e5688) as *const *const u8);
    if database.is_null() {
        return Err("resource-database-unavailable");
    }
    let count = ptr::read_unaligned(database.add(0x14).cast::<u32>());
    if count > 4096 {
        return Err("invalid-resource-database");
    }
    let entries = ptr::read_unaligned(database.add(8).cast::<*const *const u8>());
    if count > 0 && entries.is_null() {
        return Err("invalid-resource-database");
    }
    for index in 0..count {
        let resource = ptr::read(entries.add(index as usize));
        if resource.is_null() {
            return Err("invalid-resource-entry");
        }
        let value = resource.add(0x20);
        let bytes = if ptr::read(value.add(23).cast::<i8>()) < 0 {
            ptr::read(value.cast::<*const u8>())
        } else {
            value
        };
        let name = std::ffi::CStr::from_ptr(bytes.cast()).to_string_lossy();
        if name == key {
            return Ok(resource);
        }
    }
    Err("resource-unavailable")
}

/// Enumerate loaded resource names and IDs as evidence, without claiming each is typed or supported.
pub unsafe fn inventory(slide: usize) -> Value {
    let database = ptr::read((slide + 0x1032e5688) as *const *const u8);
    if database.is_null() {
        return json!({"status":"resource-database-unavailable"});
    }
    let count = ptr::read_unaligned(database.add(0x14).cast::<u32>());
    let entries = ptr::read_unaligned(database.add(8).cast::<*const *const u8>());
    if count > 4096 || (count > 0 && entries.is_null()) {
        return json!({"status":"invalid-resource-database"});
    }
    let maximum: unsafe extern "C" fn() -> i32 = mem::transmute(slide + 0x101d1448c);
    let mut resources = Vec::new();
    for index in 0..count {
        let resource = ptr::read(entries.add(index as usize));
        if resource.is_null() {
            return json!({"status":"invalid-resource-entry"});
        }
        let value = resource.add(0x20);
        let bytes = if ptr::read(value.add(23).cast::<i8>()) < 0 {
            ptr::read(value.cast::<*const u8>())
        } else {
            value
        };
        let name = std::ffi::CStr::from_ptr(bytes.cast()).to_string_lossy();
        resources.push(json!({"key":name,"id":ptr::read_unaligned(resource.add(0x18).cast::<i32>()),"address":resource as usize}));
    }
    json!({"status":"resources-enumerated","slots":maximum(),"resources":resources})
}

/// Authorize only a condition from the frozen adapter catalogue.
pub fn is_condition(id: &str, kind: &str) -> bool {
    CATALOGUE
        .get()
        .and_then(|c| c["scripts"].as_array())
        .is_some_and(|scripts| {
            scripts
                .iter()
                .any(|s| s["id"] == id && s["kind"] == kind && s["operation"] == "condition")
        })
}

fn condition_marker(token: &str, scope: *mut u8) {
    ACTIVE.with(|active| {
        let mut active = active.borrow_mut();
        let (identity, records) = active.as_mut().unwrap();
        let mut record = identity.clone();
        record["token"] = json!(token);
        record["scopeAddress"] = json!(scope as usize);
        record["sequence"] = json!(records.len());
        record["thread"] = json!(unsafe { libc::pthread_self() as usize });
        record["sink"] = json!("native-predicate-boundary");
        records.push(record);
    });
}

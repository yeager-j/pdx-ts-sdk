//! Disposable locator acquisition and destruction-aware bindings for the pinned image.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    mem, ptr,
    sync::{
        atomic::{AtomicBool, Ordering},
        LazyLock, Mutex,
    },
};

#[derive(Clone)]
struct Binding {
    public: Value,
    address: usize,
    dead: bool,
}
static INITIAL_BINDINGS_OPEN: AtomicBool = AtomicBool::new(true);
/// Close the declared saved-ID acquisition phase before setup mutates the world.
pub fn begin_setup() {
    INITIAL_BINDINGS_OPEN.store(false, Ordering::SeqCst);
}
static BINDINGS: LazyLock<Mutex<HashMap<String, Binding>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DEATHS: LazyLock<Mutex<Vec<Value>>> = LazyLock::new(|| Mutex::new(Vec::new()));

/// Permanently retire acquired tokens before the original destructor runs.
pub unsafe fn destroyed(kind: &str, address: *const u8) {
    let Some((_, offset)) = layout(kind) else {
        return;
    };
    let id = ptr::read_unaligned(address.add(offset).cast::<u32>());
    for binding in BINDINGS.lock().unwrap().values_mut() {
        if binding.public["kind"] == kind && binding.address == address as usize {
            binding.dead = true;
        }
    }
    DEATHS
        .lock()
        .unwrap()
        .push(json!({"kind":kind,"id":id,"address":address as usize}));
}
unsafe fn pointer(base: *const u8, offset: usize) -> *const u8 {
    ptr::read_unaligned(base.add(offset).cast())
}
unsafe fn number(base: *const u8, offset: usize) -> u32 {
    ptr::read_unaligned(base.add(offset).cast())
}
fn layout(kind: &str) -> Option<(usize, usize)> {
    match kind {
        "country" => Some((0x103299f00, 0x20)),
        "planet" => Some((0x10329a418, 0x18)),
        _ => None,
    }
}
unsafe fn resolve_id(slide: usize, kind: &str, id: u32) -> Option<*const u8> {
    let (symbol, offset) = layout(kind)?;
    let db = ptr::read((slide + symbol) as *const *const u8);
    if db.is_null() {
        return None;
    }
    let index = (id & 0xffffff) as usize;
    if index >= number(db, 0x20) as usize {
        return None;
    }
    let object = pointer(pointer(db, 0x18), index * 16 + 8);
    if object.is_null() || number(object, offset) != id {
        return None;
    }
    Some(object)
}
unsafe fn text(slide: usize, flag: u16) -> String {
    let get: unsafe extern "C" fn(u16) -> *const u8 = mem::transmute(slide + 0x10229ff0c);
    let value = get(flag);
    let bytes = if ptr::read(value.add(23).cast::<i8>()) < 0 {
        pointer(value, 0)
    } else {
        value
    };
    if bytes.is_null() {
        return "<null>".into();
    }
    let length = libc::strnlen(bytes.cast(), 256);
    String::from_utf8_lossy(std::slice::from_raw_parts(bytes, length)).into_owned()
}

/// Capture actual global targets and canonical planet identities; no game time is advanced.
pub unsafe fn inspect(slide: usize) -> Value {
    let state = ptr::read((slide + 0x1032e53c0) as *const *const u8);
    if state.is_null() {
        return json!({"status":"no-world"});
    }
    let count = number(state, 0x13c) as usize;
    if count > 10000 {
        return json!({"status":"invalid-target-count"});
    }
    let entries = pointer(state, 0x130);
    let mut targets = Vec::new();
    for index in 0..count {
        let entry = entries.add(index * 46);
        let flag = ptr::read_unaligned(entry.add(44).cast::<u16>());
        let name = text(slide, flag);
        if !name.starts_with("sdk446_") {
            continue;
        }
        let scope = ptr::read_unaligned(entry.add(8).cast::<u64>());
        let native_id = number(entry, 16);
        let mut record = json!({"name":name,"engineScope":scope,"nativeId":native_id,"secondaryId":number(entry,36),"live":false});
        if scope == 4 {
            // Observed country scope; verified by SetCountry and the game witness.
            record["kind"] = json!("country");
            record["id"] = json!(native_id);
            if let Some(object) = resolve_id(slide, "country", native_id) {
                record["address"] = json!(object as usize);
                record["live"] = json!(true);
            }
        } else if scope == 2 || scope == (1u64 << 40) {
            let get: unsafe extern "C" fn(*const u8) -> *const u8 =
                mem::transmute(slide + 0x1004ec678);
            let object = get(entry);
            if !object.is_null() {
                let id = number(object, 0x18);
                record["kind"] = json!("planet");
                record["id"] = json!(id);
                if resolve_id(slide, "planet", id) == Some(object) {
                    record["address"] = json!(object as usize);
                    record["live"] = json!(true);
                }
            }
        } else {
            record["kind"] = json!("unsupported");
        }
        targets.push(record);
    }
    let get_player: unsafe extern "C" fn(*const u8) -> *const u8 =
        mem::transmute(slide + 0x10070dfa0);
    let player = get_player(state);
    json!({"status":"inspected","targets":targets,"player":{"id":number(player,0x20),"address":player as usize,"subject":subject("country", number(player,0x20), player as usize)},"deaths":DEATHS.lock().unwrap().clone()})
}

/// Acquire from a live engine target or declared initial fixture ID; retain a private token.
pub unsafe fn acquire(slide: usize, request: &Value, world: &str) -> Value {
    let kind = request["kind"].as_str().unwrap_or_default();
    if layout(kind).is_none() {
        return json!({"status":"wrong-kind"});
    }
    if request["suite"].as_str() != world.rsplit_once(':').map(|(suite, _)| suite) {
        return json!({"status":"foreign-suite"});
    }
    let observed = inspect(slide);
    let object = match request["locator"].as_str() {
        Some("native-unique") => {
            let matches = match native_matches(
                slide,
                kind,
                request["condition"].as_str().unwrap_or_default(),
            ) {
                Ok(matches) => matches,
                Err(reason) => return json!({"status":reason}),
            };
            match matches.len() {
                0 => return json!({"status":"zero-matches","matches":matches}),
                1 => matches[0].clone(),
                _ => return json!({"status":"multiple-matches","matches":matches}),
            }
        }
        Some("player") if kind == "country" => observed["player"].clone(),
        Some("target") | Some("unique-result") => {
            let Some(target) = observed["targets"]
                .as_array()
                .and_then(|ts| ts.iter().find(|t| t["name"] == request["target"]))
            else {
                return json!({"status":"missing-target"});
            };
            if target["kind"] != kind {
                return json!({"status":"wrong-kind","target":target});
            }
            if target["live"] != true {
                return json!({"status":"dead-target","target":target});
            }
            target.clone()
        }
        Some("saved-id") => {
            // Probe policy is fixed to the captured baseline, before setup; validation is an engine witness target.
            if request["fixtureHash"]
                != "8ebf6264ded5f253ee5830091f73e42ee956a669ff5814e67abd6b0bfac0cba2"
                || std::env::var("SDK442_SOURCE_FIXTURE_SHA256")
                    .ok()
                    .as_deref()
                    != request["fixtureHash"].as_str()
                || request["phase"] != "initial"
                || !INITIAL_BINDINGS_OPEN.load(Ordering::SeqCst)
            {
                return json!({"status":"undeclared-saved-id"});
            }
            let declaration = match request["declaration"].as_str() {
                Some("player") => ("country", 0, "sdk442_player"),
                Some("homeworld") => ("planet", 3, "sdk442_colonized"),
                Some("barren") => ("planet", 5, "sdk442_uncolonized"),
                Some("false-homeworld") => ("planet", 3, "sdk442_uncolonized"),
                _ => return json!({"status":"undeclared-saved-id"}),
            };
            if kind != declaration.0 || request["savedId"].as_u64() != Some(declaration.1) {
                return json!({"status":"undeclared-saved-id"});
            }
            let Some(id) = request["savedId"]
                .as_u64()
                .filter(|id| *id <= u32::MAX as u64)
            else {
                return json!({"status":"invalid-id"});
            };
            let Some(address) = resolve_id(slide, kind, id as u32) else {
                return json!({"status":"dead-id"});
            };
            let validation = observed["targets"]
                .as_array()
                .and_then(|ts| ts.iter().find(|t| t["name"] == declaration.2));
            if !validation.is_some_and(|t| t["kind"] == kind && t["id"] == id && t["live"] == true)
            {
                return json!({"status":"failed-validation"});
            }
            json!({"id":id,"address":address as usize})
        }
        _ => return json!({"status":"invalid-locator"}),
    };
    let Some(id) = object["id"].as_u64() else {
        return json!({"status":"identity-unavailable"});
    };
    let Some(address) = resolve_id(slide, kind, id as u32) else {
        return json!({"status":"dead-object"});
    };
    if object["address"].as_u64() != Some(address as u64) {
        return json!({"status":"identity-mismatch"});
    }
    let token = request["id"].as_str().unwrap_or_default().to_owned();
    let public = json!({"token":token,"kind":kind,"id":id,"world":world,"suite":request["suite"],"phaseAcquired":request["phase"],"subject":subject(kind,id as u32,address as usize)});
    BINDINGS.lock().unwrap().insert(
        token,
        Binding {
            public: public.clone(),
            address: address as usize,
            dead: false,
        },
    );
    json!({"status":"bound","binding":public,"source":object})
}

/// Validate the issued token without re-resolving its original locator.
pub unsafe fn validate(slide: usize, request: &Value, world: &str) -> Value {
    let supplied = &request["binding"];
    if supplied["world"] != world || supplied["suite"] != request["suite"] {
        return json!({"status":"foreign-world-or-suite"});
    }
    let bindings = BINDINGS.lock().unwrap();
    let Some(binding) = supplied["token"]
        .as_str()
        .and_then(|token| bindings.get(token))
    else {
        return json!({"status":"unknown-binding"});
    };
    if &binding.public != supplied {
        return json!({"status":"altered-binding"});
    }
    if binding.dead {
        return json!({"status":"destroyed-binding"});
    }
    let kind = supplied["kind"].as_str().unwrap();
    let id = supplied["id"].as_u64().unwrap() as u32;
    let Some(address) = resolve_id(slide, kind, id) else {
        return json!({"status":"dead-binding"});
    };
    if address as usize != binding.address {
        return json!({"status":"replaced-binding"});
    }
    json!({"status":"live-binding","binding":supplied,"address":address as usize})
}

/// Experimental control: switch the local human through the game's selected-country setter.
pub unsafe fn switch_player(slide: usize, request: &Value) -> Value {
    let Some(id) = request["countryId"]
        .as_u64()
        .filter(|id| *id <= u32::MAX as u64)
    else {
        return json!({"status":"invalid-id"});
    };
    let Some(country) = resolve_id(slide, "country", id as u32) else {
        return json!({"status":"dead-id"});
    };
    let state = ptr::read((slide + 0x1032e53c0) as *const *const u8);
    let human: unsafe extern "C" fn(*const u8) -> *mut u8 = mem::transmute(slide + 0x100715978);
    let select: unsafe extern "C" fn(*mut u8, *const u8) = mem::transmute(slide + 0x10085da40);
    select(human(state), country);
    json!({"status":"player-switch-returned","after":inspect(slide)})
}

#[repr(align(16))]
struct Scope([u8; 0x180]);

/// Evaluate a fixed parsed condition against every current live table entry, without advancing time.
unsafe fn native_matches(
    slide: usize,
    kind: &str,
    event_id: &str,
) -> Result<Vec<Value>, &'static str> {
    if !crate::prepared::is_condition(event_id, kind) {
        return Err("undeclared-condition");
    }
    let definition = crate::engine::resolve_definition(slide, event_id)
        .map_err(|_| "missing-condition")?
        .definition;
    let expected_scope = if kind == "country" { 4 } else { 2 };
    if ptr::read_unaligned(definition.add(0x68).cast::<u64>()) != expected_scope {
        return Err("wrong-condition-kind");
    }
    let (database_symbol, id_offset) = layout(kind).ok_or("wrong-kind")?;
    let database = ptr::read((slide + database_symbol) as *const *const u8);
    if database.is_null() {
        return Err("missing-database");
    }
    let count = number(database, 0x20);
    if count > 1000000 {
        return Err("invalid-database-count");
    }
    let entries = pointer(database, 0x18);
    let construct: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x1004e6cf0);
    let destroy: unsafe extern "C" fn(*mut u8) = mem::transmute(slide + 0x100040c6c);
    let set: unsafe extern "C" fn(*mut u8, *const u8) = mem::transmute(
        slide
            + if kind == "country" {
                0x1004e3848
            } else {
                0x1004e3384
            },
    );
    let evaluate: unsafe extern "C" fn(*const u8, *mut u8) -> bool =
        mem::transmute(slide + 0x1004bb600);
    let mut matches = Vec::new();
    for index in 0..count {
        let object = pointer(entries, index as usize * 16 + 8);
        if object.is_null() {
            continue;
        }
        let id = number(object, id_offset);
        if resolve_id(slide, kind, id) != Some(object) {
            continue;
        }
        let mut scope = Scope([0; 0x180]);
        construct(scope.0.as_mut_ptr());
        set(scope.0.as_mut_ptr(), object);
        let matched = evaluate(definition, scope.0.as_mut_ptr());
        destroy(scope.0.as_mut_ptr());
        if matched {
            matches.push(json!({"id":id,"address":object as usize,"condition":event_id,"engineScope":expected_scope}));
        }
    }
    Ok(matches)
}

/// Stable lifetime label; destructor history distinguishes complete ID/address reuse.
fn subject(kind: &str, id: u32, address: usize) -> String {
    let generation = DEATHS
        .lock()
        .unwrap()
        .iter()
        .filter(|death| death["kind"] == kind && death["address"] == address)
        .count();
    format!("{kind}:{id}:{address}:{generation}")
}

// Throwaway SDK448 bridge for the pinned Windows x64 Cygnus 4.5.0 executable.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <algorithm>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
#include "json.hpp"
#include "MinHook.h"
#include "pins.hpp"

using Json = nlohmann::json;
using Byte = unsigned char;
namespace fs = std::filesystem;
static uintptr_t base;
static fs::path directory;
static std::string world;
static Json configuration;
static HHOOK messageHookHandle;
static HMODULE module;
static DWORD mainThread;
static bool busy, faulted;
static std::atomic<unsigned long> polls;
static std::mutex lifetimesMutex;

template<class T> static T read(const void* object, size_t offset=0) {
    T value;
    memcpy(&value,static_cast<const Byte*>(object)+offset,sizeof(T));
    return value;
}
template<class Function> static Function engine(size_t rva) { return reinterpret_cast<Function>(base+rva); }
static Byte* global(size_t rva) { return read<Byte*>(reinterpret_cast<void*>(base+rva)); }
static void writeJson(const fs::path& name,const Json& value) {
    auto target=directory/name;
    auto temporary=target; temporary+=L".tmp";
    { std::ofstream output(temporary); output.exceptions(std::ios::badbit|std::ios::failbit); output<<value.dump(2)<<'\n'; }
    if(!MoveFileExW(temporary.c_str(),target.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("evidence-write-failed");
}
static std::string nativeString(const Byte* string) {
    auto size=read<size_t>(string,0x20);
    auto capacity=read<size_t>(string,0x28);
    if(size>4096) throw std::runtime_error("overlong-native-string");
    const char* text=capacity>=16 ? read<const char*>(string,0x10) : reinterpret_cast<const char*>(string+0x10);
    if(!text) throw std::runtime_error("null-native-string");
    return std::string(text,size);
}
struct NativeString {
    alignas(16) Byte bytes[48];
    explicit NativeString(const std::string& text) { engine<void(*)(void*,const char*)>(0x15b700)(bytes,text.c_str()); }
    ~NativeString() { engine<void(*)(void*)>(0x15baf0)(bytes); }
};
static Byte* lookup(const std::string& kind,unsigned id) {
    auto database=global(kind=="country"?0x310ef40:0x310f110);
    if(!database) return nullptr;
    unsigned index=id&0xffffff;
    if(index>=read<unsigned>(database,0x20)) return nullptr;
    auto object=read<Byte*>(read<Byte*>(database,0x18),index*16+8);
    if(!object || read<unsigned>(object,kind=="country"?0x20:0x18)!=id) return nullptr;
    return object;
}
static unsigned objectId(const std::string& kind,Byte* object) { return read<unsigned>(object,kind=="country"?0x20:0x18); }
static std::string addressKey(const std::string& kind,Byte* object) { return kind+":"+std::to_string(reinterpret_cast<uintptr_t>(object)); }
struct Binding { Json wire; Byte* object; unsigned id; bool dead=false; std::string subject; };
static std::map<std::string,Binding> bindings;
static std::map<std::string,unsigned> generations;
static Json deaths=Json::array();
static std::string subject(const std::string& kind,Byte* object) {
    std::lock_guard lock(lifetimesMutex);
    return addressKey(kind,object)+":"+std::to_string(objectId(kind,object))+":"+std::to_string(generations[addressKey(kind,object)]);
}
using Destructor=void*(*)(Byte*);
static Destructor countryDestructor,planetDestructor;
static void retire(const std::string& kind,Byte* object) {
    std::lock_guard lock(lifetimesMutex);
    ++generations[addressKey(kind,object)];
    for(auto& [token,binding]:bindings) if(binding.object==object && binding.wire["scope"]==kind) binding.dead=true;
    deaths.push_back({{"kind",kind},{"id",objectId(kind,object)},{"address",reinterpret_cast<uintptr_t>(object)},{"tid",GetCurrentThreadId()}});
}
static void* destroyCountry(Byte* object) { retire("country",object); return countryDestructor(object); }
static void* destroyPlanet(Byte* object) { retire("planet",object); return planetDestructor(object); }

static Byte* player() {
    auto state=global(0x310ea08);
    if(!state || !read<Byte>(state,0xa0)) throw std::runtime_error("world-not-ready");
    auto object=engine<Byte*(*)(Byte*)>(0x265220)(state);
    if(!object || object!=lookup("country",objectId("country",object))) throw std::runtime_error("player-unavailable");
    return object;
}
static Json snapshot() {
    auto state=global(0x310ea08),idler=global(0x310f168);
    auto human=player();
    if(!idler) throw std::runtime_error("idler-unavailable");
    int date=read<int>(state,0xc0);
    if(date%24) throw std::runtime_error("nonintegral-date");
    return {{"world",world},{"day",date/24},{"paused",read<Byte>(idler,0x594)!=0},{"ai",read<Byte>(reinterpret_cast<void*>(base+0x280e822))?"on":"off"},{"player",subject("country",human)}};
}
static Json targets() {
    auto state=global(0x310ea08);
    unsigned count=read<unsigned>(state,0x14c);
    if(count>10000) throw std::runtime_error("invalid-target-count");
    auto entries=read<Byte*>(state,0x140);
    auto names=global(0x2896948);
    unsigned nameCount=read<unsigned>(reinterpret_cast<void*>(base+0x2896954));
    Json found=Json::array();
    for(unsigned index=0;index<count;++index) {
        auto entry=entries+index*46;
        unsigned nameIndex=read<unsigned short>(entry,44);
        if(nameIndex>=nameCount) throw std::runtime_error("invalid-target-name-index");
        std::string name=nativeString(names+nameIndex*48);
        if(!name.starts_with("sdk446_")) continue;
        auto scope=read<uint64_t>(entry,8);
        unsigned id=read<unsigned>(entry,16);
        std::string kind=scope==4?"country":scope==2||scope==(1ULL<<40)?"planet":"unsupported";
        Byte* object=nullptr;
        if(kind=="country") object=lookup(kind,id);
        if(kind=="planet") {
            auto candidate=engine<Byte*(*)(Byte*)>(0x392800)(entry);
            if(candidate && candidate==lookup(kind,objectId(kind,candidate))) { object=candidate; id=objectId(kind,candidate); }
        }
        found.push_back({{"name",name},{"scope",scope},{"kind",kind},{"id",id},{"address",reinterpret_cast<uintptr_t>(object)},{"live",object!=nullptr}});
    }
    return found;
}
static Byte* definition(const std::string& name,const std::string& kind) {
    auto manager=global(0x314cf78);
    if(!manager) throw std::runtime_error("event-manager-unavailable");
    NativeString key(name);
    unsigned id=engine<unsigned(*)(void*,void*)>(0x3f6360)(manager,key.bytes);
    auto handle=engine<Byte*(*)(void*,unsigned)>(0x3f65e0)(manager,id);
    auto event=handle?read<Byte*>(handle):nullptr;
    if(!event || nativeString(event+0x10)!=name) throw std::runtime_error("definition-not-resolved");
    if(read<uint64_t>(event,0x70)!=(kind=="country"?4ULL:2ULL)) throw std::runtime_error("definition-scope-mismatch");
    return event;
}
static Byte& randomForbidden() { return *reinterpret_cast<Byte*>(base+0x280dce8); }
struct NativeRandomPermission {
    Byte previous=randomForbidden();
    // Native console event entry 0xeb63f3/0xeb6400 and restoration 0xeb6b52.
    NativeRandomPermission() { randomForbidden()=0; }
    ~NativeRandomPermission() { randomForbidden()=previous; }
};
struct NativeScope {
    NativeRandomPermission randomPermission;
    alignas(16) Byte bytes[0x200]={0};
    NativeScope(const std::string& kind,Byte* object) {
        auto seed=engine<unsigned(*)(const char*,int)>(0x1a77350)("sdk448_bridge",1);
        engine<void(*)(void*,unsigned)>(0x3903b0)(bytes,seed);
        engine<void(*)(void*,void*)>(kind=="country"?0x38e240:0x38dfe0)(bytes,object);
    }
    ~NativeScope() { engine<void(*)(void*)>(0x235fd0)(bytes); }
};
static bool condition(const Json& script,Byte* object) {
    std::string kind=script["scope"];
    auto event=definition(script["definitionId"],kind);
    NativeScope scope(kind,object);
    return engine<bool(*)(void*,void*)>(0x8e41d0)(event,scope.bytes);
}
static thread_local Json* activeMarkers=nullptr;
static thread_local const Json* activeInvocation=nullptr;
using LogEffect=void(*)(Byte*,Byte*);
static LogEffect originalLog;
static void logEffect(Byte* effect,Byte* scope) {
    if(activeMarkers) {
        auto token=nativeString(effect+0xc0);
        if(token.starts_with("SDK446:")) activeMarkers->push_back({{"token",token},{"invocation",*activeInvocation},{"effect",reinterpret_cast<uintptr_t>(effect)},{"scope",reinterpret_cast<uintptr_t>(scope)},{"tid",GetCurrentThreadId()},{"randomForbidden",randomForbidden()}});
    }
    originalLog(effect,scope);
}
static Json issueBinding(const std::string& kind,Byte* object) {
    auto identity=subject(kind,object);
    std::lock_guard lock(lifetimesMutex);
    std::string token=world+":binding:"+std::to_string(bindings.size()+1);
    Json wire={{"token",token},{"world",world},{"scope",kind}};
    bindings.emplace(token,Binding{wire,object,objectId(kind,object),false,identity});
    return wire;
}
static Binding* validate(const Json& wire) {
    auto token=wire.value("token",std::string());
    auto it=bindings.find(token);
    if(it==bindings.end() || it->second.wire!=wire) return nullptr;
    auto& binding=it->second;
    if(binding.dead || lookup(wire["scope"],binding.id)!=binding.object) return nullptr;
    return &binding;
}
static Json rejected(const std::string& reason) { return {{"kind","rejected"},{"reason",reason},{"mutation","none"}}; }
static Json completed(const Json& value) { return {{"kind","completed"},{"value",value}}; }
static Json resolve(const Json& locator) {
    std::string kind=locator["scope"];
    if(locator["kind"]=="player") {
        if(kind!="country") return rejected("wrong-object-kind");
        return completed(issueBinding(kind,player()));
    }
    if(locator["kind"]=="target") {
        for(const auto& target:targets()) if(target["name"]==locator["name"]) {
            if(target["kind"]!=kind) return rejected("wrong-object-kind");
            if(target["live"]!=true) return rejected("missing-object");
            return completed(issueBinding(kind,reinterpret_cast<Byte*>(target["address"].get<uintptr_t>())));
        }
        return rejected("missing-object");
    }
    if(locator["kind"]!="unique") throw std::runtime_error("unsupported-locator");
    const auto& script=configuration["scripts"].at(locator["condition"].get<std::string>());
    if(script["scope"]!=kind || script["kind"]!="condition") throw std::runtime_error("invalid-unique-condition");
    auto database=global(kind=="country"?0x310ef40:0x310f110);
    unsigned count=read<unsigned>(database,0x20);
    if(count>1000000) throw std::runtime_error("invalid-db-count");
    Byte* match=nullptr;
    for(unsigned index=0;index<count;++index) {
        auto object=read<Byte*>(read<Byte*>(database,0x18),index*16+8);
        if(!object || lookup(kind,objectId(kind,object))!=object) continue;
        if(condition(script,object)) { if(match) return rejected("ambiguous-object"); match=object; }
    }
    if(!match) return rejected("missing-object");
    return completed(issueBinding(kind,match));
}
static Json invoke(const Json& command,const Json& invocation,Binding& binding,Json& evidence,Json& raw) {
    std::string name=command["script"];
    const auto& script=configuration["scripts"].at(name);
    std::string kind=script["scope"],id=script["definitionId"];
    if(binding.wire["scope"]!=kind) return rejected("wrong-object-kind");
    auto event=definition(id,kind);
    NativeScope scope(kind,binding.object);
    Json markers=Json::array();
    auto capture=[&](const std::string& token) { markers.push_back({{"token",token},{"invocation",invocation},{"tid",GetCurrentThreadId()},{"randomForbidden",randomForbidden()}}); };
    Json value;
    activeMarkers=&markers; activeInvocation=&invocation;
    if(script["kind"]=="condition") {
        capture("start");
        bool observed=engine<bool(*)(void*,void*)>(0x8e41d0)(event,scope.bytes);
        capture(observed?"result:true":"result:false"); capture("end"); value=observed;
    } else {
        engine<void(*)(void*,void*,int,void*)>(0x8e4910)(event,scope.bytes,0,nullptr);
        value={{"subject",binding.subject}};
    }
    activeMarkers=nullptr; activeInvocation=nullptr;
    raw["capturedMarkers"]=markers;
    std::string fault=configuration.value("fault",std::string());
    if(fault=="missing-end" && !markers.empty()) markers.erase(markers.size()-1);
    if(fault=="stale-invocation" && !markers.empty()) markers[0]["invocation"]["id"]="stale";
    raw["admittedMarkers"]=markers;
    Json tokens=Json::array();
    for(const auto& marker:markers) {
        if(marker["invocation"]!=invocation) throw std::runtime_error("marker-identity-mismatch");
        std::string token=marker["token"];
        std::string prefix="SDK446:"+id+":";
        tokens.push_back(token.starts_with(prefix)?token.substr(prefix.size()):token);
    }
    Json expected=script["kind"]=="condition"?Json::array({"start",value.get<bool>()?"result:true":"result:false","end"}):Json::array({"start","end"});
    if(tokens!=expected) throw std::runtime_error("native-markers-incomplete");
    evidence["script"]={{"id",name},{"sha256",configuration["scriptHashes"][name]},{"markers",tokens},{"correlatedAtNativeBoundary",true}};
    return completed(value);
}
static int save(const std::string& name) {
    auto idler=global(0x310f168);
    auto manager=idler?read<Byte*>(idler,0xf90):nullptr;
    if(!manager || read<Byte>(manager,0x68)) throw std::runtime_error("save-unavailable-or-pending");
    NativeString key(name);
    return engine<int(*)(void*,void*,bool,bool)>(0xa86dd0)(manager,key.bytes,false,false);
}
static bool normalBoundary() {
    void* frames[64]; auto count=CaptureStackBackTrace(0,64,frames,nullptr);
    for(unsigned i=0;i<count;++i) if(reinterpret_cast<uintptr_t>(frames[i])==base+0x1a4798a) return true;
    return false;
}
static Json process(const Json& request,Json& raw) {
    if(request["run"]!=configuration["runId"] || request["world"]!=world || request["pid"]!=GetCurrentProcessId()) throw std::runtime_error("request-identity-mismatch");
    if(GetCurrentThreadId()!=mainThread || !normalBoundary()) throw std::runtime_error("outside-normal-main-thread-boundary");
    const auto& action=request["action"];
    auto before=snapshot(); raw["before"]=before;
    if(action=="inspect") return {{"snapshot",before},{"targets",targets()},{"deaths",deaths},{"savePending",read<Byte>(read<Byte*>(global(0x310f168),0xf90),0x68)!=0}};
    if(action=="ai-off") {
        if(before["ai"]=="on") {
            alignas(16) Byte output[64]={0};
            engine<void(*)(void*,void*,void*)>(0xeb4780)(output,nullptr,nullptr);
            raw["toggleText"]=nativeString(output+8);
            engine<void(*)(void*)>(0x15baf0)(output+8);
        }
        auto after=snapshot(); if(after["ai"]!="off") throw std::runtime_error("ai-off-not-established");
        return {{"snapshot",after}};
    }
    if(action=="save") return {{"saveRequestCode",save(request["name"])},{"snapshot",snapshot()}};
    if(action!="perform") throw std::runtime_error("unsupported-native-action");
    if(configuration.value("fault",std::string())=="hang") for(;;) Sleep(1000);
    if(before["paused"]!=true || before["ai"]!="off") throw std::runtime_error("execution-state-not-established");
    const auto& command=request["command"];
    const auto& invocation=request["invocation"];
    if(invocation["run"]!=request["run"] || invocation["world"]!=world || invocation["id"]!=request["id"]) throw std::runtime_error("invocation-identity-mismatch");
    Json evidence={{"invocation",invocation},{"before",before},{"raw",Json::array({"native/response-"+request["id"].get<std::string>()+".json"})},{"nativeCompleted",true}};
    Json outcome;
    if(command["kind"]=="snapshot") outcome=completed(before);
    else if(command["kind"]=="resolve") outcome=resolve(command["locator"]);
    else if(command["kind"]=="advance") {
        int days=command["days"]; if(days<1||days>360) throw std::runtime_error("invalid-day-count");
        engine<void(*)(int,bool)>(0xa1b290)(days,false);
        auto after=snapshot(); if(after["day"].get<int>()-before["day"].get<int>()!=days || after["paused"]!=true) throw std::runtime_error("advance-incomplete");
        outcome=completed(after);
    } else {
        const auto& wire=command["binding"];
        if(wire.value("world",std::string())!=world) outcome={{"kind","contract-error"},{"reason","foreign-binding"},{"mutation","none"}};
        else if(auto binding=validate(wire)) {
            if(command["kind"]=="validate") outcome=completed({{"subject",binding->subject}});
            else if(command["kind"]=="invoke") outcome=invoke(command,invocation,*binding,evidence,raw);
            else throw std::runtime_error("unsupported-command");
        } else outcome=rejected("invalid-binding");
    }
    evidence["after"]=snapshot(); outcome["evidence"]=evidence;
    raw["deaths"]=deaths; return {{"outcome",outcome}};
}
static void poll() {
    ++polls;
    if(busy||faulted) return;
    if(!normalBoundary()) return;
    busy=true;
    try {
        auto pending=directory/L"request.json";
        if(fs::exists(pending)) {
            Json request; { std::ifstream input(pending); input>>request; }
            std::string id=request.at("id");
            auto consumed=directory/("request-"+id+".json");
            if(fs::exists(consumed)) throw std::runtime_error("duplicate-request-refused");
            fs::rename(pending,consumed);
            Json raw={{"request",request},{"pid",GetCurrentProcessId()},{"tid",GetCurrentThreadId()},{"normalBoundary",true}};
            raw["randomForbiddenBefore"]=randomForbidden();
            try { raw["reply"]=process(request,raw); }
            catch(const std::exception& error) { raw["error"]=error.what(); }
            raw["randomForbiddenAfter"]=randomForbidden();
            writeJson("response-"+id+".json",raw);
        }
        try { writeJson("ready.json",{{"snapshot",snapshot()},{"tid",GetCurrentThreadId()},{"polls",polls.load()},{"normalBoundary",true}}); } catch(const std::exception&) { }
    } catch(const std::exception& error) { writeJson("bridge-failure.json",{{"error",error.what()}}); faulted=true; }
    busy=false;
}
static LRESULT CALLBACK messageHook(int code,WPARAM wp,LPARAM lp) {
    if(code>=0) {
        __try { poll(); }
        __except(EXCEPTION_EXECUTE_HANDLER) { faulted=true; }
    }
    return CallNextHookEx(messageHookHandle,code,wp,lp);
}
static void installHook(size_t rva,void* replacement,void** original) {
    const auto& pin=pins.at(rva);
    if(memcmp(reinterpret_cast<void*>(base+rva),pin.data(),pin.size())) throw std::runtime_error("hook-prologue-mismatch");
    if(MH_CreateHook(reinterpret_cast<void*>(base+rva),replacement,original)!=MH_OK) throw std::runtime_error("hook-creation-failed");
}
static DWORD WINAPI initialize(void*) {
    try {
        wchar_t path[4096]; GetEnvironmentVariableW(L"SDK448_NATIVE",path,4096); directory=path;
        { std::ifstream input(directory/L"configuration.json"); input>>configuration; }
        mainThread=configuration["mainThread"]; base=reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
        world=configuration["runId"].get<std::string>()+":"+std::to_string(GetCurrentProcessId());
        if(MH_Initialize()!=MH_OK) throw std::runtime_error("hook-initialization-failed");
        installHook(0x6d9db0,reinterpret_cast<void*>(destroyCountry),reinterpret_cast<void**>(&countryDestructor));
        installHook(0xdf4010,reinterpret_cast<void*>(destroyPlanet),reinterpret_cast<void**>(&planetDestructor));
        installHook(0x173eec0,reinterpret_cast<void*>(logEffect),reinterpret_cast<void**>(&originalLog));
        if(MH_EnableHook(MH_ALL_HOOKS)!=MH_OK) throw std::runtime_error("hook-enable-failed");
        messageHookHandle=SetWindowsHookExW(WH_GETMESSAGE,messageHook,module,mainThread);
        if(!messageHookHandle) throw std::runtime_error("message-hook-failed");
        writeJson("loaded.json",{{"pid",GetCurrentProcessId()},{"mainThread",mainThread},{"world",world},{"base",base}});
        for(;;) { PostThreadMessageW(mainThread,WM_NULL,0,0); Sleep(100); }
    } catch(const std::exception& error) { try { writeJson("bridge-failure.json",{{"error",error.what()}}); } catch(...) { } }
    return 1;
}
BOOL WINAPI DllMain(HINSTANCE instance,DWORD reason,void*) {
    if(reason==DLL_PROCESS_ATTACH) {
        module=instance; DisableThreadLibraryCalls(instance);
        auto thread=CreateThread(nullptr,0,initialize,nullptr,0,nullptr); if(thread) CloseHandle(thread);
    }
    return TRUE;
}

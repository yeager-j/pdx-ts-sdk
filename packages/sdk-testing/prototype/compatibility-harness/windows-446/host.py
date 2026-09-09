"""Throwaway isolated Windows process owner. The independent adapter can request disposal."""
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

run = Path(sys.argv[1]).resolve()
config = json.loads((run / 'host-input.json').read_text())
native = run / 'native'
profile = run / 'profile'
alias = Path(config['profileAlias'])
game = Path(config['game'])
u = c.WinDLL('user32', use_last_error=True)
k = c.WinDLL('kernel32', use_last_error=True)

class Startup(c.Structure):
    _fields_ = [('cb',w.DWORD),('reserved',w.LPWSTR),('desktop',w.LPWSTR),('title',w.LPWSTR),('x',w.DWORD),('y',w.DWORD),('sx',w.DWORD),('sy',w.DWORD),('cx',w.DWORD),('cy',w.DWORD),('fill',w.DWORD),('flags',w.DWORD),('show',w.WORD),('reserved2size',w.WORD),('reserved2',c.c_void_p),('stdin',w.HANDLE),('stdout',w.HANDLE),('stderr',w.HANDLE)]
class Process(c.Structure):
    _fields_ = [('process',w.HANDLE),('thread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]

def api(library, name, arguments, result=w.BOOL):
    function = getattr(library, name)
    function.argtypes, function.restype = arguments, result
    return function

create_desktop = api(u,'CreateDesktopW',[w.LPCWSTR,c.c_void_p,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p],w.HANDLE)
close_desktop = api(u,'CloseDesktop',[w.HANDLE])
open_input = api(u,'OpenInputDesktop',[w.DWORD,w.BOOL,w.DWORD],w.HANDLE)
object_info = api(u,'GetUserObjectInformationW',[w.HANDLE,c.c_int,c.c_void_p,w.DWORD,c.POINTER(w.DWORD)])
foreground = api(u,'GetForegroundWindow',[],w.HWND)
window_pid = api(u,'GetWindowThreadProcessId',[w.HWND,c.POINTER(w.DWORD)],w.DWORD)
window_visible = api(u,'IsWindowVisible',[w.HWND])
window_callback = c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
enum_windows = api(u,'EnumDesktopWindows',[w.HANDLE,window_callback,w.LPARAM])
create_process = api(k,'CreateProcessW',[w.LPCWSTR,w.LPWSTR,c.c_void_p,c.c_void_p,w.BOOL,w.DWORD,c.c_void_p,w.LPCWSTR,c.POINTER(Startup),c.POINTER(Process)])
wait = api(k,'WaitForSingleObject',[w.HANDLE,w.DWORD],w.DWORD)
terminate = api(k,'TerminateProcess',[w.HANDLE,w.UINT])
close = api(k,'CloseHandle',[w.HANDLE])
resume = api(k,'ResumeThread',[w.HANDLE],w.DWORD)
create_job = api(k,'CreateJobObjectW',[c.c_void_p,w.LPCWSTR],w.HANDLE)
set_job = api(k,'SetInformationJobObject',[w.HANDLE,c.c_int,c.c_void_p,w.DWORD])
assign_job = api(k,'AssignProcessToJobObject',[w.HANDLE,w.HANDLE])
alloc = api(k,'VirtualAllocEx',[w.HANDLE,c.c_void_p,c.c_size_t,w.DWORD,w.DWORD],c.c_void_p)
write_memory = api(k,'WriteProcessMemory',[w.HANDLE,c.c_void_p,c.c_void_p,c.c_size_t,c.POINTER(c.c_size_t)])
module_handle = api(k,'GetModuleHandleW',[w.LPCWSTR],w.HMODULE)
procedure = api(k,'GetProcAddress',[w.HMODULE,c.c_char_p],c.c_void_p)
remote_thread = api(k,'CreateRemoteThread',[w.HANDLE,c.c_void_p,c.c_size_t,c.c_void_p,c.c_void_p,w.DWORD,c.POINTER(w.DWORD)],w.HANDLE)
exit_thread = api(k,'GetExitCodeThread',[w.HANDLE,c.POINTER(w.DWORD)])
exit_process = api(k,'GetExitCodeProcess',[w.HANDLE,c.POINTER(w.DWORD)])
modules = api(k,'K32EnumProcessModulesEx',[w.HANDLE,c.c_void_p,w.DWORD,c.POINTER(w.DWORD),w.DWORD])
module_name = api(k,'K32GetModuleFileNameExW',[w.HANDLE,w.HMODULE,w.LPWSTR,w.DWORD],w.DWORD)

def write(name, value):
    target = run / name
    temporary = target.with_suffix(target.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    os.replace(temporary, target)

def check(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value

def input_desktop():
    handle = check(open_input(0,False,1))
    name, needed = c.create_unicode_buffer(256), w.DWORD()
    try:
        check(object_info(handle,2,name,c.sizeof(name),c.byref(needed)))
        return name.value
    finally:
        close_desktop(handle)

def game_windows(desktop, pid):
    found = []
    @window_callback
    def visit(window, parameter):
        owner = w.DWORD()
        thread = window_pid(window,c.byref(owner))
        if owner.value == pid:
            found.append({'window':window,'thread':thread,'visibleStyle':bool(window_visible(window))})
        return True
    check(enum_windows(desktop,visit,0))
    return found

def inject(process):
    handles, needed = (w.HMODULE*512)(), w.DWORD()
    check(modules(process.process,handles,c.sizeof(handles),c.byref(needed),3))
    kernel = None
    for handle in handles[:needed.value//c.sizeof(w.HMODULE)]:
        name = c.create_unicode_buffer(2048)
        check(module_name(process.process,handle,name,len(name)))
        if Path(name.value).name.lower() == 'kernel32.dll':
            kernel = handle
    if not kernel:
        raise RuntimeError('Remote kernel32 identity unavailable')
    local_kernel = module_handle('kernel32.dll')
    load = kernel + procedure(local_kernel,b'LoadLibraryW') - local_kernel
    path = c.create_unicode_buffer(str(native / 'bridge.dll'))
    remote = check(alloc(process.process,None,c.sizeof(path),0x3000,4))
    written = c.c_size_t()
    check(write_memory(process.process,remote,path,c.sizeof(path),c.byref(written)))
    thread = check(remote_thread(process.process,None,0,load,remote,0,None))
    try:
        waited = wait(thread,10000)
        code = w.DWORD()
        check(exit_thread(thread,c.byref(code)))
        write('injection.json',{'wait':waited,'moduleLow32':code.value,'remoteKernel32':kernel,'remoteLoadLibraryW':load})
        if waited != 0 or code.value == 0:
            raise RuntimeError('DLL loading not established')
    finally:
        close(thread)

desktop_name = 'sdk449_' + config['runId'].replace('-','')
desktop = job = None
process = Process()
samples = []
started = time.monotonic()
try:
    if '-' in str(alias) or alias.exists() or not profile.is_dir():
        raise RuntimeError('Profile alias must be new, hyphen-free, and point at the prepared profile')
    alias.parent.mkdir(parents=True,exist_ok=True)
    write('ownership.json',{'runId':config['runId'],'profile':str(profile),'alias':str(alias),'game':str(game),'desktop':desktop_name,'intent':'before-junction-and-process'})
    junction = subprocess.run(['cmd.exe','/c','mklink','/J',str(alias),str(profile)],capture_output=True,text=True)
    write('junction.json',{'code':junction.returncode,'stdout':junction.stdout,'stderr':junction.stderr})
    if junction.returncode:
        raise RuntimeError('Profile junction creation failed')
    desktop = check(create_desktop(desktop_name,None,None,0,0x01ff,None))
    job = check(create_job(None,None))
    limits = c.create_string_buffer(144)
    c.c_uint32.from_buffer(limits,16).value = 0x2000
    check(set_job(job,9,limits,c.sizeof(limits)))
    startup = Startup()
    startup.cb, startup.desktop, startup.flags, startup.show = c.sizeof(startup),'WinSta0\\'+desktop_name,1,0
    args = [str(game),'--continuelastsave','-gdpr-compliant','-userdir='+alias.as_posix()+'/','-dx11']
    write('launch-command.json',{'args':args,'cwd':str(game.parent),'desktop':startup.desktop,'inputDesktop':input_desktop()})
    os.environ['SteamAppId'], os.environ['SDK449_NATIVE'] = '281990',str(native)
    check(create_process(str(game),c.create_unicode_buffer(subprocess.list2cmdline(args)),None,None,False,4,None,str(game.parent),c.byref(startup),c.byref(process)))
    check(assign_job(job,process.process))
    write('process.json',{'pid':process.pid,'tid':process.tid,'command':args,'createdAt':time.time(),'jobKillOnOwnerExit':True})
    native_config = config | {'mainThread':process.tid}
    write('native/configuration.json',native_config)
    check(resume(process.thread) != 0xffffffff)
    injected = False
    while time.monotonic()-started < 600:
        if wait(process.process,0)==0 or (run/'stop-owner').exists():
            break
        pid = w.DWORD()
        window_pid(foreground(),c.byref(pid))
        samples.append({'seconds':time.monotonic()-started,'foregroundPid':pid.value,'inputDesktop':input_desktop()})
        if len(samples) % 10 == 0:
            current = check(open_input(0,False,0x41))
            try:
                samples[-1]['inputDesktopGameWindows'] = game_windows(current,process.pid)
                samples[-1]['privateDesktopGameWindows'] = game_windows(desktop,process.pid)
            finally:
                close_desktop(current)
            write('observer.json',samples)
        if not injected and time.monotonic()-started > 8:
            inject(process)
            injected = True
        time.sleep(0.1)
    write('owner-stop.json',{'elapsedSeconds':time.monotonic()-started,'requested':(run/'stop-owner').exists()})
except BaseException as error:
    write('host-failure.json',{'error':str(error)})
finally:
    if process.process:
        if wait(process.process,0)!=0:
            terminate(process.process,99)
        waited = wait(process.process,5000)
        code = w.DWORD()
        exit_process(process.process,c.byref(code))
        write('host-disposal.json',{'pid':process.pid,'wait':waited,'exitCode':code.value,'jobKillOnOwnerExit':bool(job)})
        close(process.thread)
        close(process.process)
    if job:
        close(job)
    if desktop:
        close_desktop(desktop)
    write('observer.json',samples)
    # rmdir unlinks only this task's junction; retained profile evidence stays intact.
    if alias.is_junction() and alias.resolve()==profile.resolve():
        alias.rmdir()
    write('host-finished.json',{'finished':True,'aliasRemoved':not alias.exists(),'elapsedSeconds':time.monotonic()-started})

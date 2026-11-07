//! Lifetime ownership for automatic agents and the subprocesses they start.

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::process::Child;

use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub(super) struct Job {
    _handle: OwnedHandle,
}

impl Job {
    pub(super) fn attach(child: &Child) -> io::Result<Self> {
        // NULL security attributes make the job handle non-inheritable, so a
        // descendant cannot accidentally keep the job alive after app exit.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: CreateJobObjectW returned a fresh handle owned by this guard.
        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the handle and pointer remain valid for this synchronous API.
        let configured = unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: both handles are borrowed from live, owned objects.
        if unsafe { AssignProcessToJobObject(handle.as_raw_handle(), child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { _handle: handle })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_notes::launch::{shell_command, TrackedChild};
    use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
    };

    #[test]
    fn dropping_tracked_child_terminates_the_process() {
        let child = shell_command("ping -n 30 127.0.0.1 > NUL").spawn().unwrap();
        // Keep an independent handle so termination can be checked after the
        // tracked wrapper closes its own process handle.
        let raw = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, child.id()) };
        assert!(!raw.is_null());
        let process = unsafe { OwnedHandle::from_raw_handle(raw) };
        let tracked = TrackedChild::new(child).unwrap();
        drop(tracked);
        assert_eq!(
            unsafe { WaitForSingleObject(process.as_raw_handle(), 5000) },
            WAIT_OBJECT_0
        );
    }

    #[test]
    fn an_already_exited_child_retains_its_status() {
        let mut child = shell_command("exit /b 7").spawn().unwrap();
        assert_eq!(child.wait().unwrap().code(), Some(7));
        let mut tracked = TrackedChild::new(child).unwrap();
        assert_eq!(tracked.wait().unwrap().code(), Some(7));
    }
}

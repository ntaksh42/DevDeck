//! Waits for an agent process with a timeout, split from `runner.rs` to keep
//! files under 500 lines.

use crate::error::{AppError, Result};

pub(super) fn wait_child(
    mut child: crate::agent_notes::launch::TrackedChild,
    timeout_secs: u64,
) -> Result<std::process::ExitStatus> {
    let start = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if start.elapsed().as_secs() >= timeout_secs {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::InvalidInput("Automatic review timed out".into()));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

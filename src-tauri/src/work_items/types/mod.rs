//! Serde DTOs for the work item IPC surface: command inputs deserialized from
//! the frontend and the summaries/previews/candidates serialized back to it.

mod inputs;
mod outputs;

pub use inputs::*;
pub use outputs::*;

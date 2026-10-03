use tokio::task::JoinSet;

use crate::error::{AppError, Result};

pub(crate) struct ProjectPrResults<T> {
    rows: Vec<T>,
    warnings: Vec<String>,
    pub(crate) success_count: usize,
    last_error: Option<AppError>,
}

impl<T> Default for ProjectPrResults<T> {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            warnings: Vec::new(),
            success_count: 0,
            last_error: None,
        }
    }
}

impl<T> ProjectPrResults<T> {
    pub(crate) fn merge(&mut self, other: Self) {
        self.rows.extend(other.rows);
        self.warnings.extend(other.warnings);
        self.success_count += other.success_count;
        if other.last_error.is_some() {
            self.last_error = other.last_error;
        }
    }

    pub(crate) fn finish(mut self) -> Result<(Vec<T>, Vec<String>)> {
        if self.success_count == 0 {
            if let Some(error) = self.last_error {
                return Err(error);
            }
        }
        self.warnings.sort();
        self.warnings.dedup();
        Ok((self.rows, self.warnings))
    }
}

pub(crate) async fn collect_project_prs<T: Send + 'static>(
    mut tasks: JoinSet<(String, Result<Vec<T>>)>,
) -> Result<ProjectPrResults<T>> {
    let mut results = ProjectPrResults::default();
    while let Some(joined) = tasks.join_next().await {
        let (project, fetched) =
            joined.map_err(|e| AppError::AzureDevOps(format!("PR fetch task failed: {e}")))?;
        match fetched {
            Ok(rows) => {
                results.success_count += 1;
                results.rows.extend(rows);
            }
            Err(error) => {
                tracing::warn!(project = %project, error = %error, "skipping failed PR project fetch");
                results.warnings.push(project);
                results.last_error = Some(error);
            }
        }
    }
    Ok(results)
}

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::AdoClient;
use crate::error::Result;

use super::helpers::{
    collect_identity_picker_identities, identity_is_duplicate, identity_search_filters,
    identity_search_rank,
};
use super::types::{ConnectionData, Identity, IdentityPickerIdentity};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityPickerRequest<'a> {
    query: &'a str,
    identity_types: [&'static str; 1],
    operation_scopes: [&'static str; 1],
    options: IdentityPickerOptions,
    properties: [&'static str; 17],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct IdentityPickerOptions {
    min_results: usize,
    max_results: usize,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum IdentitySearchResponse {
    Wrapped { value: Vec<Identity> },
    List(Vec<Identity>),
}

impl AdoClient {
    pub async fn connection_data(&self) -> Result<ConnectionData> {
        self.get_json("_apis/connectionData", &[("api-version", "7.1-preview")])
            .await
    }

    pub async fn search_identities(&self, query: &str, top: usize) -> Result<Vec<Identity>> {
        let query = query.trim();
        if query.is_empty() || top == 0 {
            return Ok(Vec::new());
        }

        let mut identities = Vec::new();
        for search_filter in identity_search_filters(query) {
            let batch = self
                .search_identities_with_filter(search_filter, query)
                .await?;
            for identity in batch {
                if !identity_is_duplicate(&identities, &identity) {
                    identities.push(identity);
                }
            }
        }
        identities.sort_by_key(|identity| identity_search_rank(identity, query));
        identities.truncate(top);
        Ok(identities)
    }

    pub async fn search_identity_picker(
        &self,
        query: &str,
        top: usize,
    ) -> Result<Vec<IdentityPickerIdentity>> {
        let query = query.trim();
        if query.is_empty() || top == 0 {
            return Ok(Vec::new());
        }

        let max_results = top.clamp(5, 40);
        let response: Value = self
            .post_json(
                "_apis/IdentityPicker/Identities",
                &[("api-version", "5.0-preview.1")],
                &IdentityPickerRequest {
                    query,
                    identity_types: ["user"],
                    // "ims" only: search identities already known to the
                    // organization, not the whole backing directory (Entra ID).
                    operation_scopes: ["ims"],
                    options: IdentityPickerOptions {
                        min_results: 5,
                        max_results,
                    },
                    properties: [
                        "DisplayName",
                        "IsMru",
                        "ScopeName",
                        "SamAccountName",
                        "Active",
                        "SubjectDescriptor",
                        "Department",
                        "JobTitle",
                        "Mail",
                        "MailNickname",
                        "PhysicalDeliveryOfficeName",
                        "SignInAddress",
                        "Surname",
                        "Guest",
                        "TelephoneNumber",
                        "Manager",
                        "Description",
                    ],
                },
            )
            .await?;

        let mut identities = Vec::new();
        collect_identity_picker_identities(&response, &mut identities);
        identities.truncate(top);
        Ok(identities)
    }

    async fn search_identities_with_filter(
        &self,
        search_filter: &str,
        query: &str,
    ) -> Result<Vec<Identity>> {
        let response: IdentitySearchResponse = self
            .get_json_vssps(
                "_apis/identities",
                &[
                    ("api-version", "7.1"),
                    ("searchFilter", search_filter),
                    ("filterValue", query),
                    ("queryMembership", "None"),
                ],
            )
            .await?;
        Ok(match response {
            IdentitySearchResponse::Wrapped { value } => value,
            IdentitySearchResponse::List(value) => value,
        })
    }
}

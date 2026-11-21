//! The PR search expression is evaluated against metadata, never rich HTML.
use super::PullRequestSummary;
use crate::error::{AppError, Result};

#[derive(Debug, Clone)]
enum Matcher {
    Text(String),
    NumberPrefix(String),
    ExactId(i64),
}
#[derive(Debug, Clone)]
struct Term {
    exclude: bool,
    matcher: Matcher,
}
#[derive(Debug, Clone)]
pub(super) struct PrQuery(Vec<Term>);

impl PrQuery {
    pub(super) fn parse(query: &str, exclude_words: &str) -> Result<Self> {
        if query.chars().count() > 200 || exclude_words.chars().count() > 200 {
            return Err(invalid("Search text must be at most 200 characters"));
        }
        let mut terms = tokenize(query)?;
        let mut excluded = tokenize(exclude_words)?;
        for term in &mut excluded {
            term.exclude = true;
        }
        terms.extend(excluded);
        if terms.len() > 20 {
            return Err(invalid("Use at most 20 search terms"));
        }
        Ok(Self(terms))
    }

    pub(super) fn matches(&self, pr: &PullRequestSummary) -> bool {
        let fields: Vec<String> = [
            pr.title.as_str(),
            pr.project_name.as_str(),
            pr.repository_name.as_str(),
            pr.created_by.as_deref().unwrap_or_default(),
            pr.source_ref_name.as_str(),
            pr.target_ref_name.as_str(),
        ]
        .into_iter()
        .map(str::to_lowercase)
        .collect();
        self.0.iter().all(|term| {
            let matched = match &term.matcher {
                Matcher::ExactId(id) => pr.pull_request_id == *id,
                Matcher::Text(text) => fields.iter().any(|field| field.contains(text)),
                Matcher::NumberPrefix(number) => {
                    pr.pull_request_id.to_string().starts_with(number)
                        || fields.iter().any(|field| field.contains(number))
                }
            };
            matched != term.exclude
        })
    }
}

fn invalid(message: &str) -> AppError {
    AppError::InvalidInput(message.into())
}

fn tokenize(raw: &str) -> Result<Vec<Term>> {
    let mut chars = raw.chars().peekable();
    let mut terms = Vec::new();
    while chars.peek().is_some() {
        while chars.peek().is_some_and(|c| c.is_whitespace()) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }
        let exclude = chars.peek() == Some(&'-');
        if exclude {
            chars.next();
        }
        let quoted = chars.peek() == Some(&'"');
        let mut value = String::new();
        if quoted {
            chars.next();
            let mut closed = false;
            while let Some(c) = chars.next() {
                match c {
                    '"' => {
                        closed = true;
                        break;
                    }
                    '\\' if chars.peek().is_some_and(|c| *c == '\\' || *c == '"') => {
                        value.push(chars.next().expect("peeked escape"));
                    }
                    '\\' => {
                        return Err(invalid(
                            "Use \\\" or \\\\ to escape characters inside a phrase.",
                        ))
                    }
                    _ => value.push(c),
                }
            }
            if !closed {
                return Err(invalid("Close the quotation mark before searching"));
            }
            if chars.peek().is_some_and(|c| !c.is_whitespace()) {
                return Err(invalid("Separate search phrases with a space"));
            }
        } else {
            while let Some(c) = chars.peek() {
                if c.is_whitespace() {
                    break;
                }
                if *c == '"' {
                    return Err(invalid("Start a quoted phrase after a space"));
                }
                value.push(chars.next().expect("peeked character"));
            }
        }
        if value.trim().is_empty() {
            return Err(invalid("Enter a word or phrase after the search operator"));
        }
        let value = value.to_lowercase();
        let matcher = if !quoted && value.starts_with('#') {
            let number = &value[1..];
            let id = number
                .parse::<i32>()
                .ok()
                .filter(|id| {
                    *id > 0
                        && !number.starts_with('0')
                        && number.bytes().all(|b| b.is_ascii_digit())
                })
                .ok_or_else(|| invalid("Use a positive PR number after #"))?;
            Matcher::ExactId(i64::from(id))
        } else if !quoted && value.bytes().all(|c| c.is_ascii_digit()) {
            Matcher::NumberPrefix(value)
        } else {
            Matcher::Text(value)
        };
        terms.push(Term { exclude, matcher });
    }
    Ok(terms)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pr() -> PullRequestSummary {
        PullRequestSummary {
            organization_id: "org".into(),
            project_id: "p".into(),
            project_name: "Web".into(),
            repository_id: "r".into(),
            repository_name: "Portal".into(),
            pull_request_id: 1234,
            title: "Fix LOGIN connection timeout 日本語 ÄBC".into(),
            created_by: Some("Alex Chen".into()),
            status: "active".into(),
            creation_date: "2026-01-01".into(),
            closed_date: None,
            source_ref_name: "fix/login".into(),
            target_ref_name: "main".into(),
            web_url: None,
            is_draft: false,
        }
    }
    #[test]
    fn and_and_exclusion_can_match_different_fields() {
        assert!(PrQuery::parse("web timeout", "test")
            .unwrap()
            .matches(&pr()));
        assert!(!PrQuery::parse("login -portal", "").unwrap().matches(&pr()));
        assert!(PrQuery::parse("-test", "").unwrap().matches(&pr()));
        assert!(!PrQuery::parse("", "\"connection timeout\"")
            .unwrap()
            .matches(&pr()));
    }
    #[test]
    fn phrases_ids_and_unicode_are_predictable() {
        for query in [
            "\"connection timeout\"",
            "#1234",
            "123",
            "日本語 äbc",
            "\"fix login\"",
        ] {
            assert!(PrQuery::parse(query, "").unwrap().matches(&pr()), "{query}");
        }
        assert!(!PrQuery::parse("#123", "").unwrap().matches(&pr()));
        let mut without_or = pr();
        without_or.repository_name = "Service".into();
        assert!(!PrQuery::parse("login OR timeout", "")
            .unwrap()
            .matches(&without_or));
    }
    #[test]
    fn invalid_queries_are_rejected() {
        for query in ["-", "\"\"", "\"missing", "#0", "#-1", "#abc", "\"foo\"bar"] {
            assert!(PrQuery::parse(query, "").is_err(), "{query}");
        }
        assert!(PrQuery::parse(&"a".repeat(201), "").is_err());
        assert!(PrQuery::parse(&"a ".repeat(21), "").is_err());
    }
    #[test]
    fn escaped_quotes_and_backslashes_stay_in_the_phrase() {
        let mut pr = pr();
        pr.title = "a \"quoted\" C:\\code".into();
        assert!(PrQuery::parse(r#""a \"quoted\"" "C:\\code""#, "")
            .unwrap()
            .matches(&pr));
    }
}

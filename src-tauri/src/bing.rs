use std::{
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use reqwest::header::ACCEPT_LANGUAGE;

use crate::error::{Error, Result};

const RESULTS: &str = "https://www.bing.com/images/async?";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const WARM_AFTER: Duration = Duration::from_secs(45);

pub struct Web {
    client: reqwest::Client,
    used: Mutex<Option<Instant>>,
}

impl Web {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Ganymede/", env!("CARGO_PKG_VERSION")))
            .timeout(REQUEST_TIMEOUT)
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("HTTP client");
        Self { client, used: Mutex::new(None) }
    }

    fn last_used(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.used.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub async fn results(&self, url: &str) -> Result<String> {
        if !url.starts_with(RESULTS) {
            return Err(Error::Input("only the Bing Images results page is allowed"));
        }
        *self.last_used() = Some(Instant::now());
        let response = self.client.get(url).header(ACCEPT_LANGUAGE, "en-US,en;q=0.9").send().await?;
        Ok(response.error_for_status()?.text().await?)
    }

    // Opens the TLS connection before the user presses Enter, so the first page skips the handshake.
    pub async fn warm(&self) {
        {
            let mut used = self.last_used();
            if used.is_some_and(|at| at.elapsed() < WARM_AFTER) {
                return;
            }
            *used = Some(Instant::now());
        }
        let _ = self.client.head("https://www.bing.com/").send().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepts_only_the_results_page() {
        let web = Web::new();
        assert!(web.results("https://example.com/?q=x").await.is_err());
        assert!(web.results("https://www.bing.com.evil.example/images/async?q=x").await.is_err());
    }

    #[tokio::test]
    #[ignore]
    async fn bing_answers_compressed_on_a_reused_connection() {
        let web = Web::new();
        let url = "https://www.bing.com/images/async?q=japanese+minka+interior&first=0&count=35&mmasync=1";
        for round in 0..3 {
            let start = Instant::now();
            let html = web.results(url).await.expect("Bing should answer");
            println!("request {round}: {:?}, {} bytes", start.elapsed(), html.len());
            assert!(html.contains("class=\"iusc\""), "no readable results");
        }
    }
}

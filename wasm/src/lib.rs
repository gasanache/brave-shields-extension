use adblock::engine::Engine;
use adblock::lists::ParseOptions;
use adblock::request::Request;
use adblock::resources::Resource;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEngine {
    engine: Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create a new engine from filter list text (one rule per line).
    #[wasm_bindgen(constructor)]
    pub fn new(filter_rules: &str) -> WasmEngine {
        let rules: Vec<&str> = filter_rules.lines().collect();
        let engine = Engine::from_rules(rules, ParseOptions::default());
        WasmEngine { engine }
    }

    /// Deserialize a previously serialized engine from bytes.
    pub fn deserialize(data: &[u8]) -> Result<WasmEngine, JsError> {
        let empty: Vec<&str> = vec![];
        let engine = Engine::from_rules(empty, ParseOptions::default());
        let mut eng = WasmEngine { engine };
        eng.engine
            .deserialize(data)
            .map_err(|e| JsError::new(&format!("Deserialization failed: {:?}", e)))?;
        Ok(eng)
    }

    /// Serialize the engine to bytes for later deserialization.
    pub fn serialize(&self) -> Vec<u8> {
        self.engine.serialize()
    }

    /// Check if a network request should be blocked.
    pub fn check_network_request(
        &self,
        url: &str,
        source_url: &str,
        request_type: &str,
    ) -> JsValue {
        let request = match Request::new(url, source_url, request_type) {
            Ok(r) => r,
            Err(_) => return JsValue::NULL,
        };
        let result = self.engine.check_network_request(&request);

        let obj = js_sys::Object::new();
        js_sys::Reflect::set(
            &obj,
            &"matched".into(),
            &JsValue::from_bool(result.matched),
        )
        .unwrap();

        if let Some(redirect) = &result.redirect {
            js_sys::Reflect::set(&obj, &"redirect".into(), &JsValue::from_str(redirect)).unwrap();
        }
        if let Some(exception) = &result.exception {
            js_sys::Reflect::set(&obj, &"exception".into(), &JsValue::from_str(exception))
                .unwrap();
        }

        obj.into()
    }

    /// Get cosmetic filtering resources for a given URL.
    pub fn url_cosmetic_resources(&self, url: &str) -> JsValue {
        let resources = self.engine.url_cosmetic_resources(url);

        let obj = js_sys::Object::new();

        let selectors = js_sys::Array::new();
        for s in &resources.hide_selectors {
            selectors.push(&JsValue::from_str(s));
        }
        js_sys::Reflect::set(&obj, &"hide_selectors".into(), &selectors).unwrap();

        js_sys::Reflect::set(
            &obj,
            &"injected_script".into(),
            &if resources.injected_script.is_empty() {
                JsValue::NULL
            } else {
                JsValue::from_str(&resources.injected_script)
            },
        )
        .unwrap();

        js_sys::Reflect::set(
            &obj,
            &"generichide".into(),
            &JsValue::from_bool(resources.generichide),
        )
        .unwrap();

        obj.into()
    }

    /// Get CSS selectors for specific classes and IDs found in the DOM.
    pub fn hidden_class_id_selectors(
        &self,
        classes: Vec<String>,
        ids: Vec<String>,
        exceptions: Vec<String>,
    ) -> Vec<String> {
        let exceptions_set: HashSet<String> = exceptions.into_iter().collect();
        self.engine
            .hidden_class_id_selectors(&classes, &ids, &exceptions_set)
    }

    /// Add resources for scriptlet/redirect resolution.
    pub fn use_resources(&mut self, resources_json: &str) {
        if let Ok(resources) = serde_json::from_str::<Vec<Resource>>(resources_json) {
            self.engine.use_resources(resources);
        }
    }
}

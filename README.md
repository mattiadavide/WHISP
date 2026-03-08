###  Technical Specifications

#### **Core Overview**

WHISP is a local, privacy-preserving, and cross-platform application designed for real-time Automated Speech Recognition (ASR). The system implements a decoupled, event-driven architecture using multiple specialized Web Workers to ensure high-performance, non-blocking UI operations.

#### **System Architecture & Data Pipeline**

* **Audio Ingestion & Normalization**: Audio is captured via `getUserMedia` or `getDisplayMedia` and processed through a custom `AudioWorkletProcessor`. It is downsampled to a 16kHz mono PCM stream, which is the native requirement for the underlying transformer models.
* **Voice Activity Detection (VAD)**: A dedicated worker executes the `onnx-community/silero-vad` model. It utilizes a dual-threshold gating mechanism (0.50 for active speech and 0.75 for initiation) to filter out ambient noise and silence, effectively reducing the compute load on the transcription engine.
* **ASR Inference Engine**: The transcription core utilizes the `@huggingface/transformers` library to run Whisper models (including `large-v3-turbo`, `base`, and `tiny`). The engine is optimized for **WebGPU** acceleration, supporting `FP16` precision to maximize throughput on compatible hardware.
* **Multi-Threading & Shared Resources**: To enable high-speed data exchange and WebGPU access, the system employs a Service Worker (`coi-serviceworker.js`) that enforces Cross-Origin-Embedder-Policy (COEP) and Cross-Origin-Opener-Policy (COOP).

#### **NLP & Contextual Refinement**

* **Dynamic Zeitgeist Synchronization**: The system can scrape RSS news feeds (Technology, Finance, Medical, etc.) to extract trending lemmas. These tokens are injected into a reference dictionary to improve the recognition of modern proper nouns and technical jargon.
* **Heuristic Text Healing**: Post-processed text tokens undergo a Levenshtein distance check. If a transcribed word closely matches a high-priority token from the reference or "Experience" dictionary (with a distance threshold of 1 or 2 depending on word length), the system automatically "heals" the transcription.
* **Feedback Loop**: Manual validations performed in the UI terminal are stored in a session-persistent dictionary, which the NLP worker uses to prioritize future corrections.

#### **Licensing and Legal**

* **Copyright**: (c) 2026 Mattia Davide Amico.
* **Terms**: All rights reserved. Reproduction, modification, distribution, or use of the source code, in whole or in part, is strictly prohibited without explicit prior written permission from the author.

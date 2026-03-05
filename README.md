🎙️ WHISP // TERMINAL
Whisp is a lightweight, purely client-side WebGPU-accelerated Speech-to-Text (STT) application. It runs deep learning models directly in the browser using Transformers.js and ONNX runtime, ensuring 100% privacy and zero server costs.

No audio data is ever sent to the cloud. Everything is processed locally on the edge.

⚙️ Core Architecture & Features
Dual-Worker & Zero-Copy Routing: The architecture completely bypasses the main thread for heavy lifting. Audio is captured via an AudioWorkletProcessor and routed directly to the VAD Worker, and subsequently to the Whisper Worker using MessageChannel transfers. This ensures zero-copy memory routing and a perfectly smooth UI.

Neural VAD (Silero): Instead of relying on simple heuristics, Whisp runs the onnx-community/silero-vad model in its own dedicated Web Worker. It accurately detects human speech and filters out background noise.

Continuous Transcription (Long-form Audio): Handles infinite speech streams without buffer overflows.

Forced Flush: The VAD worker automatically flushes audio buffers to Whisper if a monologue exceeds ~15 seconds, preventing memory saturation.

Intelligent Chunking: The Whisper pipeline is configured with a 30-second chunk length and a 5-second stride, seamlessly transcribing overlapping audio segments without losing context.

WebGPU Acceleration (with WASM fallback): Achieves near real-time transcription speeds by offloading compute to the user's GPU via WebGPU. Automatically falls back to WASM if WebGPU is unavailable.

Dynamic Engine Options:

LARGE_FP16: Best accuracy (whisper-large-v3-turbo in FP16), requires higher VRAM.

STANDARD_Q8: Great balance (whisper-large-v3-turbo quantized to 8-bit), ideal for standard hardware.

MOBILE_TINY: Ultra-lightweight (whisper-tiny in Q8), perfect for low-end devices.

Multi-source Audio: Capture audio from the physical microphone or intercept system/tab audio via getDisplayMedia (ideal for transcribing meetings or videos).

Terminal-Style UI: A retro, highly optimized DOM interface that tracks real-time Input RMS, Neural VAD probability, and extraction progress without dropping frames.

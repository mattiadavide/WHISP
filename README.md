# ▰ WHISP 1.0 — KERNEL_SPEECH_STATION

> **[ STATUS: ZERO-CLOUD / FULL-MEMORY / RAW-HARDWARE ]**
> Client-Side Neural Speech-to-Text Engine via WebGPU.

[![LAUNCH WHISP](https://img.shields.io/badge/LAUNCH-WHISP_1.0-FFB000?style=for-the-badge&labelColor=030200)](https://mattiadavide.github.io/WHISP/)

---
**SELECT_LANGUAGE:** [ [EN](#english) ] | [ [IT](#italiano) ] | [ [ES](#espanol) ] | [ [FR](#francais) ] | [ [DE](#deutsch) ]
---

<a name="english"></a>
# [ EN ] — ENGLISH_VERSION

## ◈ PHILOSOPHY: SILICON SOVEREIGNTY
Commercial STT (Speech-to-Text) systems process voice as a remote dataset, introducing network latency, recurring API costs, and severe privacy vulnerabilities. WHISP resolves this entropy by reclaiming the computational sovereignty of local silicon.

**No servers. No API keys. Zero compromises.**

Neural inference occurs entirely within the browser via **WebGPU**, isolating the acoustic stream in the client's volatile memory. Privacy is not a contractual policy; it is a mathematical consequence of the architecture.

## ◈ CORE FEATURES

WHISP doesn't just run a model; it fortifies real-world entropy through a deterministic purification pipeline:

* **Edge WebGPU Inference**: Direct injection of the acoustic model (Quantized Whisper) into the device's GPU, with dynamic fallback to WASM for resource-constrained hardware.
* **Dynamic SNR Shield (VAD)**: A Voice Activity Detection system that bypasses static thresholds to calculate background noise variance in real-time. It ignores music and applies *hard tail-clipping* to prevent neural hallucinations.
* **Quantum Phonetic Healing**: A proprietary Zero-Waste NLP engine that corrects transcription errors in post-production by comparing phonetic hashes with Levenshtein distance metrics, repairing token "bleeding."
* **Autonomous Context Bridge (Zeitgeist)**: WHISP background-assimilates global breaking news RSS feeds. It pre-loads proper names, locations, and current events into the tensor *before* the speaker utters them, eliminating out-of-vocabulary errors.
* **Semantic Guillotine (Neural Ad-Blocker)**: A "semantic drift" detector that analyzes bigram overlap. If it detects a sudden shift in context (e.g., from a news broadcast to a commercial break), it severs the autoregressive prompt to prevent text contamination.

## ◈ DATA FLOW ARCHITECTURE (PIPELINE)

The system is engineered on a topology of isolated layers, designed to guarantee O(1) latency and zero memory overhead (Zero-Waste Allocation):

1. **Raw Acquisition (Absolute Domain)**: Total bypass of black-box OS filters. The hardware delivers pure bytes, processed by a deterministic mathematical DSP chain (High-Pass, AGC, Preamplification).
2. **Thermal Barrier**: The stream enters a shared Ring Buffer. The VAD authorizes frame transit to the neural engines only if vocal entropy exceeds the background noise signature, protecting the CPU from thermal collapse.
3. **Decoding and Isolation**: The linguistic tensor translates the audio. A primary entropy filter analyzes the text's compression ratio: if it detects fractal loops or neural stuttering, it triggers an instant Cold-Start of the model.
4. **Ontological Convergence**: Raw text passes through the NLP filter, where asymmetrical thresholds force acoustic glitches to align with the sovereign dictionary loaded by the Zeitgeist module.

## ◈ P2P SWARM COMPUTING

WHISP nodes can form a **decentralized mesh** via WebRTC DataChannels, allowing compute distribution across multiple machines.

* **Local Dispatcher**: A lightweight WebSocket relay handling exclusively SDP/ICE negotiation. **Carries zero payload.**
* **Swarm Consensus**: In-browser WebRTC orchestrator. Dispatches tasks, monitors heartbeats, and resolves results through majority consensus groups.
* **Neural Volunteering**: Web nodes can load a secondary quantized LLM (`SmolLM2-135M`) to execute inference tasks requested by network peers.

## ◈ EXECUTION & DEPLOYMENT

No Docker containers, cloud instances, or Node.js backends required for voice inference. The system is a self-sufficient static web executable communicating directly with the hardware.

### Execution Requirements:
1. Browser with enabled **WebGPU** support (recent Chrome/Edge).
2. Cross-Origin Isolation (`COOP`/`COEP`) enabled by the hosting server to allow high-frequency memory synchronization (`SharedArrayBuffer`).
3. Raw hardware access to the local microphone stream.

### [ ➔ INITIALIZE WHISP 1.0 KERNEL ](https://mattiadavide.github.io/WHISP/)

---
<br><br><br>

<a name="italiano"></a>
# [ IT ] — VERSIONE_ITALIANA

## ◈ LA FILOSOFIA: SOVRANITÀ DEL SILICIO
I sistemi STT (Speech-to-Text) commerciali processano la voce come un dataset remoto, introducendo latenza di rete, costi API ricorrenti e gravi vulnerabilità per la privacy. WHISP risolve questa entropia reclamando la sovranità computazionale del silicio locale.

**Nessun server. Nessuna chiave API. Zero compromessi.**

L'inferenza neurale avviene interamente all'interno del browser tramite **WebGPU**, isolando il flusso acustico nella memoria volatile del client. La privacy non è una policy contrattuale; è una conseguenza matematica dell'architettura.

## ◈ FEATURES CORE

* **Inferenza Edge WebGPU**: Iniezione diretta di Whisper quantizzato nella GPU locale.
* **Scudo SNR Dinamico (VAD)**: Rilevazione attività vocale con tail-clipping per prevenire allucinazioni.
* **Healing Fonetico Quantistico**: Motore NLP per la riparazione degli errori post-produzione.
* **Ponte di Contesto (Zeitgeist)**: Sincronizzazione ontologica continua tramite Feed RSS di news globali.
* **Ghigliottina Semantica**: Rilevatore di deriva contestuale per isolare la pubblicità.

## ◈ ARCHITETTURA (PIPELINE)
1. **Acquisizione Cruda**: I/O microfonico bypassando i filtri di sistema.
2. **Barriera Termica**: Controllo preventivo dell'entropia audio nel Ring Buffer.
3. **Decodifica e Isolamento**: Filtro entropico per purgare loop e balbettio neurale.
4. **Convergenza Ontologica**: Correzione del testo basata sui dizionari sovrani.

### [ ➔ INIZIALIZZA IL KERNEL WHISP 1.0 ](https://mattiadavide.github.io/WHISP/)

---
<br><br><br>

<a name="espanol"></a>
# [ ES ] — VERSIÓN_ESPAÑOLA

## ◈ FILOSOFÍA: SOBERANÍA DEL SILICIO
Los sistemas STT comerciales procesan la voz como datos remotos, introduciendo latencia y riesgos de privacidad. WHISP reclama la soberanía computacional del silicio local.

**Sin servidores. Sin claves API. Compromiso cero.**

La inferencia neuronal ocurre íntegramente en el navegador a través de **WebGPU**. La privacidad es una consecuencia matemática de la arquitectura.

## ◈ CARACTERÍSTICAS PRINCIPALES
* **Inferencia Edge WebGPU**: Inyección directa del modelo Whisper en la GPU local.
* **Escudo SNR Dinámico (VAD)**: Detección de actividad vocal con recorte térmico para evitar alucinaciones.
* **Sanación Fonética Cuántica**: Motor NLP para corrección de errores mediante hashes fonéticos.
* **Puente de Contexto (Zeitgeist)**: Sincronización continua con noticias RSS en tiempo real.
* **Guillotina Semántica**: Detector de deriva para segmentar y bloquear publicidad.

## ◈ ARQUITECTURA (PIPELINE)
1. **Adquisición Pura**: Entrada de micrófono sin filtros de sistema operativo.
2. **Barrera Térmica**: Gestión del Ring Buffer basada en la entropía acústica.
3. **Decodificación y Aislamiento**: Filtro contra bucles fractales y tartamudeo neuronal.
4. **Convergencia Ontológica**: Alineación del texto con diccionarios soberanos locales.

### [ ➔ INICIALIZZA KERNEL WHISP 1.0 ](https://mattiadavide.github.io/WHISP/)

---
<br><br><br>

<a name="francais"></a>
# [ FR ] — VERSION_FRANÇAISE

## ◈ PHILOSOPHIE : SOUVERAINETÉ DU SILICIUM
Les systèmes STT commerciaux traitent la voix à distance, ce qui pose des problèmes de latence et de confidentialité. WHISP redonne la souveraineté au silicium local.

**Pas de serveurs. Pas d'API. Zéro compromis.**

L'inférence neurale s'effectue dans le navigateur via **WebGPU**. La confidentialité est un impératif mathématique structurel.

## ◈ CARACTÉRISTIQUES CLÉS
* **Inférence Edge WebGPU** : Injection directe du modèle Whisper dans le GPU de l'appareil.
* **Scudo SNR Dynamique (VAD)** : Détection vocale avec tail-clipping anti-hallucination.
* **Guérison Phonétique Quantique** : Moteur NLP pour la correction d'erreurs via hash phonétiques.
* **Pont de Contexte (Zeitgeist)** : Synchronisation ontologique avec les flux RSS d'actualités.
* **Guillotine Sémantique** : Détection de dérive pour isoler les interruptions publicitaires.

## ◈ ARCHITECTURE (PIPELINE)
1. **Acquisition Brute** : Audio direct sans traitements OS boîte noire.
2. **Barrière Thermique** : Analyse de l'entropie dans le Ring Buffer avant calcul.
3. **Décodage et Isolation** : Éradication des boucles fractales et du bégaiement neural.
4. **Convergence Ontologique** : Rectification textuelle basée sur le dictionnaire souverain.

### [ ➔ INITIALISER LE NOYAU WHISP 1.0 ](https://mattiadavide.github.io/WHISP/)

---
<br><br><br>

<a name="deutsch"></a>
# [ DE ] — DEUTSCHE_VERSION

## ◈ PHILOSOPHIE: SOUVERÄNITÄT DES SILIZIUMS
Kommerzielle STT-Systeme verarbeiten Sprache in der Cloud, was Latenz und Datenschutzrisiken birgt. WHISP fordert die Rechensouveränität des lokalen Siliziums zurück.

**Keine Server. Keine APIs. Null Kompromisse.**

Neuronale Inferenz erfolgt via **WebGPU** direkt im Browser. Datenschutz ist eine mathematische Konsequenz der Architektur.

## ◈ KERNFEATURES
* **Edge WebGPU Inferenz**: Direkte Whisper-Modell-Integration in der lokalen GPU.
* **Dynamischer SNR-Schild (VAD)**: Sprachaktivitätserkennung mit Anti-Halluzinations-Clipping.
* **Quanten-Phonetische Heilung**: NLP-Engine zur Fehlerkorrektur mittels phonetischer Hashes.
* **Kontext-Brücke (Zeitgeist)**: Ontologische Synchronisation via Nachrichten-RSS-Feeds.
* **Semantische Guillotine**: Drift-Erkennung zur automatischen Werbeblockierung.

## ◈ ARCHITEKTUR (PIPELINE)
1. **Roh-Akquise**: Mikrofon-Eingang unter Umgehung aller OS-Filter.
2. **Thermische Barriere**: Audio-Entropie-Prüfung im Ring-Puffer vor der Inferenz.
3. **Dekodierung & Isolation**: Eliminierung von Loops und neuronalem Stottern.
4. **Ontologische Konvergenz**: Textkorrektur basierend auf dem souveränen Wörterbuch.

### [ ➔ WHISP 1.0 KERNEL INITIALISIEREN ](https://mattiadavide.github.io/WHISP/)
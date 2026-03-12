export class AudioProcessor {
    constructor() {
        this.audioCtx = null;
        this.stream = null;
        this.worklet = null;
        this.isRecording = false;
    }
    async init(sourceType, vadWorker) {
        this.audioCtx = new AudioContext({ sampleRate: 16000 });
        this.stream = sourceType === 'system' 
            ? await navigator.mediaDevices.getDisplayMedia({audio: true, video: true}) 
            : await navigator.mediaDevices.getUserMedia({audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            }});
        try {
            await this.audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
            class P extends AudioWorkletProcessor {
                    constructor() { 
                        super(); 
                        this.buf = new Float32Array(512); 
                        this.normBuf = new Float32Array(512);
                        this.ptr = 0; 
                        this.vPort = null; 
                        this.port.onmessage = (e) => { 
                            if(e.data.port) this.vPort = e.data.port; 
                        }; 
                    }
                    process(inputs) {
                        const input = inputs[0][0]; 
                        if(!input || !this.vPort) return true;
                        
                        const buf = this.buf;
                        const normBuf = this.normBuf;
                        let ptr = this.ptr;

                        for(let i=0; i<input.length; i++) {
                            buf[ptr++] = input[i];
                            if(ptr >= 512) {
                                // Optimized Single-Pass Mean & RMS PRE-CALC
                                let sum = 0;
                                for(let j=0; j<512; j++) sum += buf[j];
                                const mean = sum / 512;
                                
                                let sqSum = 0;
                                for(let j=0; j<512; j++) {
                                    const s = buf[j] - mean;
                                    sqSum += s * s;
                                }
                                const rms = Math.sqrt(sqSum / 512);
                                
                                // Industrial Gain Logic
                                const gain = rms > 0.001 ? Math.min(0.2 / rms, 8.0) : 1.0;
                                
                                for(let j=0; j<512; j++) {
                                    // Soft-clipping + Gain normalization
                                    const val = (buf[j] - mean) * gain;
                                    normBuf[j] = val > 1 ? 1 : (val < -1 ? -1 : val);
                                }
                                
                                // Zero-Garbage transfer: slice().buffer creates a copy of the underlying ArrayBuffer
                                // specifically for the 512 floats, allowing vPort to take ownership without detaching this.normBuf
                                this.vPort.postMessage({type:'vad', data: normBuf.slice().buffer, rawRms: rms}, [normBuf.slice().buffer]); 
                                ptr = 0;
                            }
                        }
                        this.ptr = ptr;
                        return true;
                    }
                }
                registerProcessor('p', P);
            `], {type:'application/javascript'})));
            this.worklet = new AudioWorkletNode(this.audioCtx, 'p');
        } catch(e) {
            console.error("[APEX] AudioWorklet initialization failed:", e);
            return;
        }
        const audioChannel = new MessageChannel();
        vadWorker.postMessage({ type: 'init_worklet_port', port: audioChannel.port1 }, [audioChannel.port1]);
        this.worklet.port.postMessage({ port: audioChannel.port2 }, [audioChannel.port2]);
        this.audioCtx.createMediaStreamSource(this.stream).connect(this.worklet);
        this.isRecording = true;
    }
    stop() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop()); 
        if (this.audioCtx) this.audioCtx.close();
        this.isRecording = false;
    }
}
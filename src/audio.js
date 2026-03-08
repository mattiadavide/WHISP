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
            : await navigator.mediaDevices.getUserMedia({audio: true});

        await this.audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
            class P extends AudioWorkletProcessor {
                constructor() { 
                    super(); 
                    this.buf = new Float32Array(512); 
                    this.ptr = 0; 
                    this.vPort = null; 
                    this.port.onmessage = (e) => { 
                        if(e.data.port) this.vPort = e.data.port; 
                    }; 
                }
                process(inputs) {
                    const input = inputs[0][0]; 
                    if(!input || !this.vPort) return true;
                    for(let i=0; i<input.length; i++) {
                        this.buf[this.ptr++] = input[i];
                        if(this.ptr >= 512) {
                            this.vPort.postMessage({type:'vad', data:this.buf.slice(0).buffer}); 
                            this.ptr = 0;
                        }
                    }
                    return true;
                }
            }
            registerProcessor('p', P);
        `], {type:'application/javascript'})));

        this.worklet = new AudioWorkletNode(this.audioCtx, 'p');
        
        // Collega VAD Worker e Worklet Node
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

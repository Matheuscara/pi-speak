import { env } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";

const send = process.send?.bind(process);
if (!send) throw new Error("Speech subprocess requires an IPC channel");

type Request =
  | { id: number; type: "prepare" }
  | { id: number; type: "synthesize"; text: string; voice: string; speed: number };

type KokoroVoice = keyof KokoroTTS["voices"];

let tts: KokoroTTS | undefined;

process.on("message", async (request: Request) => {
  try {
    if (request.type === "prepare") {
      tts ??= await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q4",
        device: "cpu",
      });
      send({ id: request.id, type: "ready" });
      return;
    }
    if (!tts) throw new Error("Speech model is not prepared");
    if (!(request.voice in tts.voices)) throw new Error(`Unknown speech voice: ${request.voice}`);
    const result = await tts.generate(request.text, { voice: request.voice as KokoroVoice, speed: request.speed });
    const samples = result.audio as Float32Array;
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    send({ id: request.id, type: "audio", audio: bytes.toString("base64") });
  } catch (error) {
    send({
      id: request.id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

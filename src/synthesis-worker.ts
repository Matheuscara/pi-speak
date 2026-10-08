import { env } from "@huggingface/transformers";
import type { ephoneModule } from "ephone";
import { KokoroTTS } from "kokoro-js";

const send = process.send?.bind(process);
if (!send) throw new Error("Speech subprocess requires an IPC channel");

type Request =
  | { id: number; type: "prepare" }
  | { id: number; type: "synthesize"; text: string; voice: string; speed: number };

type KokoroVoice = keyof KokoroTTS["voices"];

let tts: KokoroTTS | undefined;
let portuguesePhonemizer: ephoneModule | undefined;

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
    let samples: Float32Array;
    if (request.voice.startsWith("p")) {
      // Load the PT-BR WASM phonemizer only when a Brazilian voice is requested.
      const { default: createEphone, roa } = await import("ephone");
      portuguesePhonemizer ??= await createEphone(roa);
      portuguesePhonemizer.setVoice("pt-BR");
      const phonemes = portuguesePhonemizer.textToIpa(request.text).replace(/\.$/, "");
      const { input_ids: inputIds } = await tts.tokenizer(phonemes, { truncation: true });
      const audio = await tts.generate_from_ids(inputIds, {
        voice: request.voice as KokoroVoice,
        speed: request.speed,
      });
      samples = audio.audio as Float32Array;
    } else {
      const audio = await tts.generate(request.text, {
        voice: request.voice as KokoroVoice,
        speed: request.speed,
      });
      samples = audio.audio as Float32Array;
    }
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

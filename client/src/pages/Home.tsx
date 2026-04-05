import { Search, Mic } from "lucide-react";
import { useMemo, useState } from "react";

declare global {
  interface Window {
    webkitSpeechRecognition?: any;
    SpeechRecognition?: any;
  }
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [message, setMessage] = useState("");

  const SpeechRecognitionCtor = useMemo(
    () => window.SpeechRecognition || window.webkitSpeechRecognition || null,
    [],
  );

  const handleSubmit = () => {
    const value = query.trim();
    if (!value) {
      setMessage("Enter a KAEK first.");
      return;
    }

    setMessage(`Searching for ${value}…`);
  };

  const handleMic = () => {
    if (!SpeechRecognitionCtor) {
      setMessage("Speech input is not supported on this browser.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "el-GR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setMessage("Listening…");
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      const cleaned = String(transcript).replace(/\s+/g, "").trim();
      setQuery(cleaned);
      setMessage(cleaned ? `Captured: ${cleaned}` : "No speech captured.");
    };

    recognition.onerror = () => {
      setMessage("Speech input failed.");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 rounded-2xl border border-neutral-300 bg-white px-3 py-3 shadow-sm">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSubmit();
              }
            }}
            placeholder="Enter KAEK"
            className="flex-1 bg-transparent px-1 text-lg text-neutral-900 outline-none"
            inputMode="numeric"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <button
            type="button"
            onClick={handleMic}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-700 active:scale-[0.98]"
            aria-label="Speech input"
            title="Speech input"
          >
            <Mic className={`h-5 w-5 ${isListening ? "text-red-500" : ""}`} />
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white active:scale-[0.98]"
            aria-label="Search"
            title="Search"
          >
            <Search className="h-5 w-5" />
          </button>
        </div>

        {message ? (
          <p className="mt-3 px-1 text-sm text-neutral-500">{message}</p>
        ) : null}
      </div>
    </main>
  );
}

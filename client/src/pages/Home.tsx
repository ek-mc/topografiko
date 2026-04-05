import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");

  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="KAEK"
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-4 text-lg text-neutral-900 outline-none focus:border-neutral-500"
        />
      </div>
    </main>
  );
}

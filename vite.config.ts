import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    netlify({
      // Projekt nie ma zadnych edge functions (katalog netlify/edge-functions
      // nie istnieje, netlify.toml ich nie deklaruje) - emulowanie ich lokalnie
      // jest wiec czysta strata.
      //
      // Emulator i tak nie startuje: @netlify/edge-functions-dev uruchamia
      // `deno eval --allow-scripts ...`, a `deno eval` tej flagi nie przyjmuje
      // ("unexpected argument '--allow-scripts' found") - takze w najnowszym
      // Deno 2.9.x, ktore wtyczka sama pobiera. Bez tego wylaczenia `npm run dev`
      // konczy sie bledem "Could not establish a connection to the Netlify Edge
      // Functions local development server" i serwer pada.
      //
      // Wylaczenie dotyczy WYLACZNIE emulacji lokalnej - wdrozenie na Netlify
      // jest nietkniete. Jesli kiedys dojda edge functions, usun te opcje.
      edgeFunctions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
})

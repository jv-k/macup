import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-20 text-center">
      <div className="flex flex-col items-center gap-5">
        <h1 className="font-mono text-5xl font-bold tracking-tight sm:text-6xl">
          macup
        </h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          A plugin-based CLI for keeping your macOS dev packages current, across
          Homebrew, npm, pnpm, the App Store, Xcode, and system updates. Version
          pins, skip lists, and an interactive wizard included.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs/getting-started/quick-start"
          className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          Quick start
        </Link>
        <Link
          href="/docs/reference/plugins"
          className="rounded-lg border border-fd-border px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
        >
          Reference
        </Link>
      </div>

      <pre className="rounded-lg border border-fd-border bg-fd-card px-4 py-3 text-sm">
        <code>pnpm add -g macup</code>
      </pre>

      <Image
        src="/screenshot.png"
        alt="macup --help"
        width={760}
        height={460}
        priority
        className="w-full max-w-3xl rounded-xl border border-fd-border shadow-lg"
      />
    </main>
  );
}

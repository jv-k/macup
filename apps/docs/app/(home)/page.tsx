import Image from 'next/image';
import Link from 'next/link';

const nextSteps = [
  {
    href: '/docs/getting-started/quick-start',
    title: 'Quick start',
    body: 'Run the wizard and update safely in five minutes.',
  },
  {
    href: '/docs/concepts/how-it-works',
    title: 'How it works',
    body: 'The host-plus-plugins model behind every command.',
  },
  {
    href: '/docs/guides/configuration',
    title: 'Configuration',
    body: 'The applist.yaml manifest and the dotfiles workflow.',
  },
  {
    href: '/docs/reference/plugins',
    title: 'Reference',
    body: 'Per-plugin commands, generated from the CLI.',
  },
];

const pillars = [
  {
    href: '/docs/guides/checking-outdated',
    title: 'One outdated view',
    body: 'Every backend in a single command.',
  },
  {
    href: '/docs/guides/configuration',
    title: 'Declarative manifest',
    body: 'A YAML file you commit to dotfiles.',
  },
  {
    href: '/docs/concepts/selective-updates',
    title: 'Pins and skips',
    body: 'Hold or exclude any package.',
  },
  {
    href: '/docs/guides/safe-updates',
    title: 'Timestamped backups',
    body: 'Recover your config after a change.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-12 px-4 py-20">
      <div className="flex flex-col items-center gap-5 text-center">
        <h1 className="font-mono text-5xl font-bold tracking-tight sm:text-6xl">macup</h1>
        <p className="max-w-2xl text-lg text-fd-muted-foreground">
          See every outdated package across Homebrew, npm, pnpm, the App Store, Xcode, and system
          updates, then update them safely from one YAML manifest you commit to your dotfiles.
        </p>
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
          <code>npm i -g macup</code>
        </pre>
        <p className="text-sm text-fd-muted-foreground">macOS only.</p>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        {nextSteps.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-xl border border-fd-border p-5 transition-colors hover:bg-fd-accent"
          >
            <div className="font-medium">{card.title}</div>
            <div className="mt-1 text-sm text-fd-muted-foreground">{card.body}</div>
          </Link>
        ))}
      </div>

      <div className="grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
        {pillars.map((pillar) => (
          <Link
            key={pillar.href}
            href={pillar.href}
            className="rounded-lg border border-fd-border p-4 text-sm transition-colors hover:bg-fd-accent"
          >
            <div className="font-medium">{pillar.title}</div>
            <div className="mt-1 text-xs text-fd-muted-foreground">{pillar.body}</div>
          </Link>
        ))}
      </div>

      {/* Neutral card frame so the dark terminal capture sits on the theme's
          own surface in both light and dark mode instead of glaring. */}
      <div className="w-full max-w-3xl rounded-xl border border-fd-border bg-fd-card p-3 shadow-lg sm:p-4">
        <Image
          src="/screenshot.png"
          alt="macup --help"
          width={760}
          height={460}
          priority
          className="w-full rounded-lg"
        />
      </div>
    </main>
  );
}

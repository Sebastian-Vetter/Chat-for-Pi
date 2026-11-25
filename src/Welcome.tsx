import { Code2, Folder, Search, Terminal } from 'lucide-react';

const starters = [
  {
    icon: Code2,
    title: 'Build something new',
    text: 'Help me plan and build a new application in this workspace.',
  },
  {
    icon: Search,
    title: 'Explore a codebase',
    text: 'Explore this workspace and explain its structure and main components.',
  },
  {
    icon: Terminal,
    title: 'Find and fix a bug',
    text: 'Help me investigate a bug. Start by asking what is going wrong.',
  },
];

interface WelcomeProps {
  cwd: string;
  choosePrompt: (text: string) => void;
  openWorkspace: () => void;
}

export default function Welcome({ cwd, choosePrompt, openWorkspace }: WelcomeProps) {
  return (
    <section className="welcome">
      <div className="welcome-label">
        <span />
        YOUR IDEAS. YOUR WORKSPACE.
      </div>
      <div className="welcome-logo">
        π<span />
      </div>
      <h1>
        What will we build<span>today?</span>
      </h1>
      <p>
        A conversation away from your next idea.
        <br />
        Write, explore, and build with Pi in your own workspace.
      </p>
      <div className="starters">
        {starters.map((item) => (
          <button key={item.title} onClick={() => choosePrompt(item.text)}>
            <item.icon size={20} />
            <strong>{item.title}</strong>
            <span>{item.text}</span>
            <span className="starter-arrow">↗</span>
          </button>
        ))}
      </div>
      <div className="welcome-note">
        <Folder size={13} />
        Working in{' '}
        <button onClick={openWorkspace}>
          {cwd.replace(/^\/Users\/[^/]+/, '~') || 'your workspace'}
        </button>
      </div>
    </section>
  );
}

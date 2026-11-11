import { Link } from 'react-router-dom';

const features = [
  { icon: '📂', title: 'Bring your data', text: 'Upload CSV, Excel, JSON or Parquet files. Your datasets stay private to your account.' },
  { icon: '💬', title: 'Ask in plain language', text: 'Describe what you want to know — summaries, trends, correlations, charts — and the AI writes the analysis for you.' },
  { icon: '🛡️', title: 'Runs in a safe sandbox', text: 'Generated Python runs in an isolated environment with no internet access, so your data never leaves.' },
  { icon: '📊', title: 'Get results you can use', text: 'See the code, the output and the charts right in your browser, and download any file the analysis produces.' },
];

const steps = ['Sign in with your email — no password needed', 'Upload a dataset and describe what you want', 'Review the code, charts and results, then iterate'];

export default function Landing() {
  return (
    <div className="landing">
      <section className="hero">
        <img src="/logo.svg" alt="" width="72" height="72" />
        <h1>Find the story in your data</h1>
        <p className="lead">
          Correlaite lets you upload a dataset, ask questions in plain language, and get AI-written Python analysis — run safely in an
          isolated sandbox, with charts and files ready to use.
        </p>
        <div className="row center-row">
          <Link to="/login" className="btn">Sign in with email</Link>
          <a href="#how" className="btn secondary">How it works</a>
        </div>
      </section>

      <section className="features">
        {features.map((f) => (
          <div className="card feature" key={f.title}>
            <div className="icon" aria-hidden>{f.icon}</div>
            <h2>{f.title}</h2>
            <p className="muted">{f.text}</p>
          </div>
        ))}
      </section>

      <section id="how" className="card how">
        <h2>How it works</h2>
        <ol>{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <Link to="/login" className="btn">Get started</Link>
      </section>
    </div>
  );
}

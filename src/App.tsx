import { Routes, Route } from "react-router-dom";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder title="AzDoDeck" />} />
    </Routes>
  );
}

export default App;

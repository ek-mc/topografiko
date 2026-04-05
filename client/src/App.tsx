import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import ExportPage from "./pages/ExportPage";

function HomeWithParams() {
  const { kaek } = useParams<{ kaek?: string }>();
  return <Home initialKaek={kaek} />;
}

function ExportWithParams() {
  const { kaek } = useParams<{ kaek?: string }>();
  return <ExportPage initialKaek={kaek} />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/o/:kaek" element={<HomeWithParams />} />
      <Route path="/o/:kaek/export" element={<ExportWithParams />} />
      <Route path="/404" element={<NotFound />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster />
          <AppRoutes />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

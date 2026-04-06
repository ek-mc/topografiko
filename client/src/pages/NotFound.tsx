import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground transition-colors">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-8">
        <div className="mb-6 flex justify-end">
          <ThemeToggle compact />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Card className="mx-4 w-full max-w-lg border border-border bg-card/90 shadow-lg backdrop-blur-sm transition-colors">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="mb-6 flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-red-100/80 animate-pulse dark:bg-red-500/15" />
                  <AlertCircle className="relative h-16 w-16 text-red-500 dark:text-red-300" />
                </div>
              </div>

              <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>

              <h2 className="mb-4 text-xl font-semibold text-muted-foreground">
                Page Not Found
              </h2>

              <p className="mb-8 leading-relaxed text-muted-foreground">
                Sorry, the page you are looking for doesn't exist.
                <br />
                It may have been moved or deleted.
              </p>

              <div className="flex flex-col justify-center gap-3 sm:flex-row">
                <Button
                  onClick={handleGoHome}
                  className="rounded-lg bg-primary px-6 py-2.5 text-primary-foreground shadow-md transition-all duration-200 hover:bg-primary/90 hover:shadow-lg"
                >
                  <Home className="mr-2 h-4 w-4" />
                  Go Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

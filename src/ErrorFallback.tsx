import { clientLog } from "./lib/client-log";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import type { FallbackProps } from "react-error-boundary";

import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";

export const ErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  // Record a safe dev-only boundary event without logging the error object.
  // Rethrowing would cause a cascade crash and blank screen.
  if (import.meta.env.DEV) {
    clientLog.error("web/errorBoundary/render", {
      resultType: "Failed",
      resultDescription: "The React error boundary caught an unhandled render error",
    });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangleIcon />
          <AlertTitle>WingDex encountered a runtime error</AlertTitle>
          <AlertDescription>
            Something unexpected happened while running the application. The error details are shown below.
          </AlertDescription>
        </Alert>
        
        <div className="bg-card border rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-sm text-muted-foreground mb-2">Error Details:</h3>
          <pre className="text-xs text-destructive bg-muted/50 p-3 rounded border overflow-auto max-h-32">
            {error.message}
          </pre>
        </div>
        
        <Button 
          onClick={resetErrorBoundary} 
          className="w-full"
          variant="outline"
        >
          <RefreshCwIcon />
          Try Again
        </Button>
      </div>
    </div>
  );
}

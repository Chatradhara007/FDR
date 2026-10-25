import { Landmark } from 'lucide-react';
import { Card } from '@/components';

// Placeholder: sign-in arrives in Phase 1.
export function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Landmark className="size-8 text-primary-700" aria-hidden />
          <h1 className="text-lg font-semibold text-slate-900">FDR Portal</h1>
          <p className="text-sm text-slate-600">Sign-in will be available soon.</p>
        </div>
      </Card>
    </div>
  );
}

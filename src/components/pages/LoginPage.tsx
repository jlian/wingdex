import { useState } from 'react'
import { Bird, Key } from '@phosphor-icons/react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import PasskeyAuthDialog from '@/components/flows/PasskeyAuthDialog'

interface LoginPageProps {
  onAuthenticated: () => void
}

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background px-4">
      <div className="mx-auto max-w-md py-16 space-y-4">
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-primary">
              <Bird size={20} weight="duotone" />
              <span className="font-semibold">WingDex</span>
            </div>
            <h1 className="text-lg font-semibold text-foreground">Welcome to WingDex</h1>
            <p className="text-sm text-muted-foreground">
              Your personal bird-watching companion. Sign in or create an account to get started.
            </p>
          </div>

          <Button className="w-full" onClick={() => setDialogOpen(true)}>
            <Key size={18} className="mr-2" />
            Continue with passkey
          </Button>
        </Card>
      </div>

      <PasskeyAuthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAuthenticated={onAuthenticated}
      />
    </div>
  )
}

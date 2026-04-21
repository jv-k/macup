import { MacupError } from '../errors';
import type { AiProvider } from '../config/schema';

export class ErrAiProviderNotConfigured extends MacupError {
  override readonly kind = 'ai-provider-not-configured';

  constructor(
    readonly provider: AiProvider,
    readonly envVars: readonly string[],
  ) {
    super(
      `AI provider "${provider}" has no API key. Set one of: ${envVars.join(', ')}.`,
    );
  }
}

export class ErrAiSdkMissing extends MacupError {
  override readonly kind = 'ai-sdk-missing';

  constructor(
    readonly provider: AiProvider,
    readonly packageName: string,
  ) {
    super(
      `AI provider "${provider}" requires the "${packageName}" package. Install it: npm install ${packageName}`,
    );
  }
}

export class ErrAiRequestFailed extends MacupError {
  override readonly kind = 'ai-request-failed';

  constructor(
    readonly provider: AiProvider,
    override readonly cause: unknown,
  ) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`AI request to "${provider}" failed: ${msg}`);
  }
}

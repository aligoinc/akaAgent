export class CampaignContentRotationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CampaignContentRotationError'
  }
}

/** One allocation and one preparation for a logical send. Channel adapters own
 * formatting, media loading and their existing AI/cancellation policy. */
export interface CampaignContentVariant<M = unknown> {
  content: string
  media: M[]
  subject?: string
}

export interface PreparedCampaignContent<M = unknown, C = string> {
  content: C
  media: M[]
  subject?: string
  variantIndex: number
}

export async function prepareCampaignContent<M, C = string>(options: {
  variantCount: number
  takeIndex: (count: number) => Promise<number>
  variant: (index: number) => CampaignContentVariant<M> | Promise<CampaignContentVariant<M>>
  prepare: (variant: CampaignContentVariant<M>, index: number) =>
    Omit<PreparedCampaignContent<M, C>, 'variantIndex'> |
    Promise<Omit<PreparedCampaignContent<M, C>, 'variantIndex'>>
  signal?: AbortSignal
}): Promise<PreparedCampaignContent<M, C>> {
  options.signal?.throwIfAborted()
  const count = options.variantCount
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid campaign content count')
  // A singleton needs neither a stored cursor nor a database request.
  let index = 0
  if (count > 1) {
    try { index = await options.takeIndex(count) }
    catch (error) {
      options.signal?.throwIfAborted()
      throw new CampaignContentRotationError(error instanceof Error ? error.message : String(error))
    }
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= Math.max(1, count)) {
    throw new CampaignContentRotationError('Invalid campaign content rotation index')
  }
  options.signal?.throwIfAborted()
  const variant = await options.variant(index)
  options.signal?.throwIfAborted()
  const prepared = await options.prepare(variant, index)
  options.signal?.throwIfAborted()
  return { ...prepared, variantIndex: index }
}

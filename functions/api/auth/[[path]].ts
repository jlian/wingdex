import { createAuth } from '../../lib/auth'

export const onRequest: PagesFunction<Env> = async (context) => {
  const auth = createAuth(context.env)
  return auth.handler(context.request)
}

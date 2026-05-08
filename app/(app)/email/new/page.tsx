import EmailBuilder from '@/components/EmailBuilder'

export const dynamic = 'force-dynamic'

export default function NewEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  // searchParams is async in Next 16 but we don't actually need to await it
  // here — `from=query` is read client-side from sessionStorage by the
  // EmailBuilder. The query param is just a UI hint.
  void searchParams
  return <EmailBuilder mode="create" />
}

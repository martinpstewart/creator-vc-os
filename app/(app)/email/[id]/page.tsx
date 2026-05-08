import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import EmailBuilder from '@/components/EmailBuilder'

export const dynamic = 'force-dynamic'

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id)) notFound()

  const supabase = await createClient()
  const { data: template, error } = await supabase
    .from('email_templates')
    .select('id, name, subject, design')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!template) notFound()

  return (
    <EmailBuilder
      mode="edit"
      initialId={template.id}
      initialName={template.name}
      initialSubject={template.subject}
      initialDesign={template.design}
    />
  )
}

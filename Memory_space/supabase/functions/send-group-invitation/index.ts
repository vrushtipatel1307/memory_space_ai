import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const siteUrl = Deno.env.get('SITE_URL')
  const authorization = request.headers.get('Authorization')
  if (!url || !anonKey || !serviceRoleKey || !siteUrl || !authorization) {
    return Response.json({ error: 'Group invitation email is not configured on the server.' }, { status: 503, headers: corsHeaders })
  }

  try {
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user?.email) return Response.json({ error: 'Sign in before inviting a group member.' }, { status: 401, headers: corsHeaders })

    const body = await request.json()
    const groupId = String(body.group_id ?? '')
    const email = String(body.invited_email ?? '').trim().toLowerCase()
    if (!/^[0-9a-f-]{36}$/i.test(groupId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Enter a valid group and email address.' }, { status: 400, headers: corsHeaders })
    }
    if (email === user.email.toLowerCase()) return Response.json({ error: 'You already belong to this group.' }, { status: 400, headers: corsHeaders })

    const { data: membership, error: membershipError } = await userClient.from('group_members').select('role').eq('group_id', groupId).eq('user_id', user.id).maybeSingle()
    if (membershipError || !membership || !['owner', 'admin'].includes(membership.role)) {
      return Response.json({ error: 'Only group owners and admins can invite members.' }, { status: 403, headers: corsHeaders })
    }
    const { data: group, error: groupError } = await userClient.from('groups').select('name').eq('id', groupId).single()
    if (groupError || !group) return Response.json({ error: 'Group not found.' }, { status: 404, headers: corsHeaders })
    const { data: invitation, error: invitationError } = await userClient.from('group_invitations').insert({
      group_id: groupId,
      invited_email: email,
      invited_by: user.id,
    }).select('id').single()
    if (invitationError || !invitation) return Response.json({ error: invitationError?.message ?? 'Could not create the invitation.' }, { status: 400, headers: corsHeaders })

    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const redirectTo = `${siteUrl.replace(/\/$/, '')}/?group_invitation=${invitation.id}`
    const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { group_invitation_id: invitation.id, invited_to_group: group.name },
    })

    if (!inviteError) return Response.json({ delivery: 'invite_email' }, { headers: corsHeaders })

    // Existing accounts cannot receive a second Auth invite; send a sign-in link instead.
    if (/already|registered|exists/i.test(inviteError.message)) {
      const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error: otpError } = await publicClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      })
      if (!otpError) return Response.json({ delivery: 'sign_in_email' }, { headers: corsHeaders })
      await userClient.from('group_invitations').delete().eq('id', invitation.id)
      return Response.json({ error: otpError.message }, { status: 502, headers: corsHeaders })
    }

    await userClient.from('group_invitations').delete().eq('id', invitation.id)
    return Response.json({ error: inviteError.message }, { status: 502, headers: corsHeaders })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not send the group invitation.' }, { status: 500, headers: corsHeaders })
  }
})

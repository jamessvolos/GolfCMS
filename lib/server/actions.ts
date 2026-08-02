'use server';

import { redirect } from 'next/navigation';
import { profileInputSchema, updateProfile } from './content';

export interface ProfileFormState {
  error: string | null;
}

export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const parsed = profileInputSchema.safeParse({
    name: formData.get('name'),
    handicap: formData.get('handicap'),
    clubSpeed: formData.get('clubSpeed'),
    shotShape: formData.get('shotShape'),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Check the form values.',
    };
  }
  await updateProfile(parsed.data);
  redirect('/');
}

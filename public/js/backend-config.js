/**
 * TraktiRie Backend Config
 * ------------------------------------------------------------
 * Values here are safe to put in the frontend (they are not secrets):
 * - Supabase anon key is designed to be public; real security is
 *   handled by Row Level Security on the Supabase side.
 * - Cloudinary unsigned upload presets are meant to be called
 *   directly from the browser.
 *
 * NEVER put the Turso auth token or Supabase service_role key here.
 * Those must only live in Vercel Environment Variables (see SETUP.md).
 */
window.TraktiRieBackend = {
  supabase: {
    url: 'https://REPLACE-THIS.supabase.co',
    anonKey: 'REPLACE-WITH-ANON-PUBLIC-KEY'
  },
  cloudinary: {
    cloudName: 'REPLACE-WITH-CLOUD-NAME',
    uploadPreset: 'REPLACE-WITH-UPLOAD-PRESET-NAME'
  }
};

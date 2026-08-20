import { llmsIndex } from "@/lib/llms-index";

export const revalidate = false;

export function GET() {
  return new Response(llmsIndex());
}

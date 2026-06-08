import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { getPeopleService } from "../lib/google";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  if (!req.session?.googleAccessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

router.post("/contacts/parse", requireAuth, async (req, res) => {
  const { text } = req.body as { text: string };

  if (!text?.trim()) {
    return res.status(400).json({ error: "Contact text is required" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a contact information extraction assistant. Extract contact details from unstructured text and return them as a JSON object. 
The text may include names in multiple languages (e.g. Russian and English), company names in multiple languages, emails, phone numbers, websites, and other details.

Return a JSON object with these fields:
- givenName: first name (use the primary/Latin version if multiple)
- familyName: last name (use the primary/Latin version if multiple)
- nameAlternative: name in another language if present (e.g. Cyrillic version), or null
- company: company name (use the primary/Latin version if multiple), or null
- companyAlternative: company name in another language if present, or null
- jobTitle: job title, or null
- emails: array of email addresses (empty array if none)
- phones: array of phone numbers (empty array if none)  
- websites: array of website URLs (empty array if none)
- notes: any additional info that doesn't fit other fields, or null

Return ONLY the JSON object, no explanation.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    res.json(parsed);
  } catch (err) {
    req.log.error({ err }, "Failed to parse contact");
    res.status(500).json({ error: "Failed to parse contact text" });
  }
});

router.post("/contacts/create", requireAuth, async (req, res) => {
  const contact = req.body;

  try {
    const people = getPeopleService(req.session.googleAccessToken!);

    const names: any[] = [
      {
        givenName: contact.givenName,
        familyName: contact.familyName,
      },
    ];

    if (contact.nameAlternative) {
      names.push({ displayName: contact.nameAlternative });
    }

    const emailAddresses = (contact.emails ?? []).map((email: string) => ({
      value: email,
    }));

    const phoneNumbers = (contact.phones ?? []).map((phone: string) => ({
      value: phone,
    }));

    const urls = (contact.websites ?? []).map((url: string) => ({
      value: url,
    }));

    const organizations: any[] = [];
    if (contact.company) {
      organizations.push({
        name: contact.company,
        title: contact.jobTitle ?? undefined,
      });
    }

    const biographies: any[] = [];
    if (contact.notes) {
      biographies.push({ value: contact.notes });
    }

    const { data: created } = await people.people.createContact({
      requestBody: {
        names,
        emailAddresses,
        phoneNumbers,
        urls,
        organizations,
        biographies,
      },
    });

    res.json({
      resourceName: created.resourceName,
      contact,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create Google contact");
    res.status(500).json({ error: "Failed to create contact in Google" });
  }
});

router.post("/contacts/update", requireAuth, async (req, res) => {
  const { resourceName, correction, currentContact } = req.body as {
    resourceName: string;
    correction: string;
    currentContact: any;
  };

  try {
    // Use AI to apply the correction to the current contact
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a contact information editor. Given a current contact JSON and a correction message from the user, return the updated contact JSON with the correction applied.

Return ONLY the updated JSON object with the same structure as the input contact, no explanation.`,
        },
        {
          role: "user",
          content: `Current contact: ${JSON.stringify(currentContact, null, 2)}\n\nCorrection: ${correction}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    const updatedContact = JSON.parse(content);

    // Now update in Google Contacts
    const people = getPeopleService(req.session.googleAccessToken!);

    // First get the current etag
    const { data: existing } = await people.people.get({
      resourceName,
      personFields: "names,emailAddresses,phoneNumbers,urls,organizations,biographies",
    });

    const names: any[] = [
      {
        givenName: updatedContact.givenName,
        familyName: updatedContact.familyName,
      },
    ];

    if (updatedContact.nameAlternative) {
      names.push({ displayName: updatedContact.nameAlternative });
    }

    const { data: updated } = await people.people.updateContact({
      resourceName,
      updatePersonFields: "names,emailAddresses,phoneNumbers,urls,organizations,biographies",
      requestBody: {
        etag: existing.etag,
        names,
        emailAddresses: (updatedContact.emails ?? []).map((e: string) => ({ value: e })),
        phoneNumbers: (updatedContact.phones ?? []).map((p: string) => ({ value: p })),
        urls: (updatedContact.websites ?? []).map((u: string) => ({ value: u })),
        organizations: updatedContact.company
          ? [{ name: updatedContact.company, title: updatedContact.jobTitle ?? undefined }]
          : [],
        biographies: updatedContact.notes ? [{ value: updatedContact.notes }] : [],
      },
    });

    res.json({
      resourceName: updated.resourceName ?? resourceName,
      contact: updatedContact,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update Google contact");
    res.status(500).json({ error: "Failed to update contact in Google" });
  }
});

export default router;

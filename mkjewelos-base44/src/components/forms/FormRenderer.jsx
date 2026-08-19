const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import FormFieldRenderer from './FormFieldRenderer';
import { validateForm, isFieldVisible, buildSubmissionPayload, handleSubmissionSideEffects } from './formEngine';

export default function FormRenderer({ 
  form, 
  userProfile, 
  user,
  linkedEntityType = null,
  linkedEntityId = null,
  linkedEntityName = null,
  onSuccess,
  onCancel,
  prefillData = {}
}) {
  const [formValues, setFormValues] = useState(
    Object.fromEntries((form?.fields || []).map(f => [f.id, prefillData[f.id] ?? f.default_value ?? '']))
  );
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const startTime = useRef(Date.now());

  const handleChange = (fieldId, value) => {
    setFormValues(prev => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) setErrors(prev => { const e = { ...prev }; delete e[fieldId]; return e; });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { valid, errors: validationErrors } = validateForm(form.fields || [], formValues);
    if (!valid) {
      setErrors(validationErrors);
      const firstError = Object.keys(validationErrors)[0];
      document.getElementById(firstError)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSubmitting(true);
    const payload = buildSubmissionPayload({
      form,
      formValues,
      userProfile,
      user,
      linkedEntityType,
      linkedEntityId,
      linkedEntityName,
      startTime: startTime.current,
    });

    const submission = await db.entities.FormSubmission.create(payload);

    // Update form submission count
    await db.entities.FormTemplate.update(form.id, {
      submissions_count: (form.submissions_count || 0) + 1,
    });

    // Handle side effects (auto-create tasks etc.)
    await handleSubmissionSideEffects(form, submission, userProfile);

    setSubmitting(false);
    setSubmitted(true);
    onSuccess?.(submission);
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center py-12"
      >
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">Submitted!</h3>
        <p className="text-slate-500 text-sm">
          {form.settings?.success_message || 'Your response has been recorded.'}
        </p>
        {onCancel && (
          <Button onClick={onCancel} variant="outline" className="mt-6">
            Close
          </Button>
        )}
      </motion.div>
    );
  }

  const visibleFields = (form?.fields || []).filter(f => isFieldVisible(f, formValues));

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid grid-cols-2 gap-4">
        {visibleFields.map((field) => (
          <div key={field.id} id={field.id} className={field.width === 'half' ? 'col-span-1' : 'col-span-2'}>
            <FormFieldRenderer
              field={field}
              value={formValues[field.id]}
              onChange={(val) => handleChange(field.id, val)}
              error={errors[field.id]}
              disabled={submitting}
            />
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-8">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={submitting}
          className={`${onCancel ? 'flex-1' : 'w-full'} bg-amber-500 hover:bg-amber-600`}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Submit
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
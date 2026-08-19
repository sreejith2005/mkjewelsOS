import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Star, Minus } from 'lucide-react';

/**
 * Renders a single form field based on its type definition.
 * Used by the form renderer and preview.
 */
export default function FormFieldRenderer({ field, value, onChange, error, disabled = false }) {
  const commonProps = {
    disabled,
    className: error ? 'border-rose-400 focus-visible:ring-rose-400' : '',
  };

  const renderInput = () => {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'phone':
        return (
          <Input
            {...commonProps}
            type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
          />
        );

      case 'number':
        return (
          <Input
            {...commonProps}
            type="number"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );

      case 'currency':
        return (
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium">₹</span>
            <Input
              {...commonProps}
              type="number"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder || '0'}
              className={`pl-8 ${commonProps.className}`}
              min={field.validation?.min}
              max={field.validation?.max}
            />
          </div>
        );

      case 'date':
        return (
          <Input
            {...commonProps}
            type="date"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'datetime':
        return (
          <Input
            {...commonProps}
            type="datetime-local"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        );

      case 'textarea':
        return (
          <Textarea
            {...commonProps}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            className={`h-24 resize-none ${commonProps.className}`}
          />
        );

      case 'select':
        return (
          <Select value={value || ''} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={commonProps.className}>
              <SelectValue placeholder={field.placeholder || 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'multiselect':
        const selected = Array.isArray(value) ? value : [];
        return (
          <div className="space-y-2">
            {(field.options || []).map((opt) => (
              <div key={opt} className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(opt)}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    onChange(checked ? [...selected, opt] : selected.filter(v => v !== opt));
                  }}
                />
                <span className="text-sm text-slate-700">{opt}</span>
              </div>
            ))}
          </div>
        );

      case 'radio':
        return (
          <RadioGroup value={value || ''} onValueChange={onChange} disabled={disabled}>
            <div className="space-y-2">
              {(field.options || []).map((opt) => (
                <div key={opt} className="flex items-center gap-2">
                  <RadioGroupItem value={opt} id={`${field.id}_${opt}`} />
                  <Label htmlFor={`${field.id}_${opt}`} className="font-normal text-slate-700">{opt}</Label>
                </div>
              ))}
            </div>
          </RadioGroup>
        );

      case 'checkbox':
        return (
          <div className="flex items-center gap-3 pt-1">
            <Checkbox
              checked={value === true || value === 'true'}
              disabled={disabled}
              onCheckedChange={(v) => onChange(v)}
              id={field.id}
            />
            <Label htmlFor={field.id} className="font-normal text-slate-700 cursor-pointer">
              {field.placeholder || 'Check if applicable'}
            </Label>
          </div>
        );

      case 'file':
        return (
          <Input
            type="file"
            disabled={disabled}
            onChange={(e) => onChange(e.target.files?.[0] || null)}
            className={commonProps.className}
          />
        );

      case 'rating':
        const rating = parseInt(value) || 0;
        return (
          <div className="flex gap-1 pt-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                disabled={disabled}
                onClick={() => onChange(star)}
                className="transition-transform hover:scale-110"
              >
                <Star className={`h-7 w-7 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
              </button>
            ))}
          </div>
        );

      case 'heading':
        return (
          <div className="pt-2">
            <h3 className="font-bold text-slate-800 text-base">{field.label}</h3>
          </div>
        );

      case 'divider':
        return <Minus className="w-full text-slate-200 my-2" style={{ strokeWidth: 1 }} />;

      default:
        return (
          <Input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || ''}
            disabled={disabled}
          />
        );
    }
  };

  const isLayout = ['heading', 'divider'].includes(field.type);

  if (isLayout) {
    return (
      <div className={field.width === 'half' ? 'col-span-1' : 'col-span-2'}>
        {renderInput()}
      </div>
    );
  }

  return (
    <div className={field.width === 'half' ? 'col-span-1' : 'col-span-2'}>
      <Label className="flex items-center gap-1 mb-1.5">
        {field.label}
        {field.required && <span className="text-rose-500">*</span>}
      </Label>
      {renderInput()}
      {field.helper_text && !error && (
        <p className="text-xs text-slate-400 mt-1">{field.helper_text}</p>
      )}
      {error && (
        <p className="text-xs text-rose-500 mt-1 flex items-center gap-1">
          <span>⚠</span> {error}
        </p>
      )}
    </div>
  );
}
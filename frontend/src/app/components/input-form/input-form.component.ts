import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HoroscopePayload } from '../../services/astrology.service';

@Component({
  selector: 'app-input-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './input-form.component.html',
  styleUrl: './input-form.component.css'
})
export class InputFormComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);
  @Input() prefillName = '';
  @Input() prefillBirthDate = '';
  @Input() prefillQuestion = '';
  @Output() submitHoroscope = new EventEmitter<HoroscopePayload>();
  @Output() submitMore = new EventEmitter<void>();

  readonly quickQuestions = [
    'Tuan nay chuyen tinh cam cua minh the nao?',
    'Co hoi cong viec dang den khong?',
    '6 thang toi minh can tranh dieu gi?',
    'Nguoi cu co quay lai khong?'
  ];

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    birthDate: ['', Validators.required],
    birthTime: [''],
    question: ['', [Validators.required, Validators.minLength(8)]]
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitHoroscope.emit(this.form.getRawValue() as HoroscopePayload);
  }

  askMore(): void {
    this.submitMore.emit();
  }

  fillQuickQuestion(question: string): void {
    this.form.patchValue({ question });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['prefillName']?.currentValue) {
      this.form.patchValue({ name: String(changes['prefillName'].currentValue) });
    }
    if (changes['prefillBirthDate']?.currentValue) {
      const v = String(changes['prefillBirthDate'].currentValue || '').trim();
      if (v) {
        this.form.patchValue({ birthDate: v });
      }
    }
    if (changes['prefillQuestion']?.currentValue) {
      this.form.patchValue({ question: String(changes['prefillQuestion'].currentValue) });
    }
  }
}

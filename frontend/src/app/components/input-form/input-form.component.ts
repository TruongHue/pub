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
  @Input() operatorActive = false;
  @Input() operatorField: '' | 'name' | 'birthDate' | 'question' = '';
  @Input() operatorPulse = false;
  /** Đồng bộ với loading Oracle từ app — khóa form + hiển thị trên nút gửi */
  @Input() oracleLoading = false;
  @Output() submitHoroscope = new EventEmitter<HoroscopePayload>();
  @Output() submitMore = new EventEmitter<void>();

  readonly quickQuestions = [
    'Tuần này chuyện tình cảm của mình thế nào?',
    'Cơ hội công việc đang đến không?',
    '6 tháng tới mình cần tránh điều gì?',
    'Người cũ có quay lại không?'
  ];

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    birthDate: ['', Validators.required],
    birthTime: [''],
    question: ['', [Validators.required, Validators.minLength(8)]]
  });

  submit(): void {
    if (this.oracleLoading) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitHoroscope.emit(this.form.getRawValue() as HoroscopePayload);
  }

  askMore(): void {
    if (this.oracleLoading) {
      return;
    }
    this.submitMore.emit();
  }

  fillQuickQuestion(question: string): void {
    if (this.oracleLoading) {
      return;
    }
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

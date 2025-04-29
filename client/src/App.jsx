import React, { useState, useEffect, useRef } from 'react';
import { PhotoIcon, TrashIcon } from '@heroicons/react/24/solid';

const STORAGE_KEY = 'radioiqFormData';
const API_URL = import.meta.env.VITE_API_URL; 

const initialState = {
  patientName: '',
  dateOfExam: '',
  patientId: '',
  gender: '',
  age: '',
  location: '',
  referredPhysician: '',
  radiologist: '',
  examType: '',
  bodyPart: '',
  tbPossibility: '',
  doctorNotes: '',
  isAbnormal: false,
  abnormalities: [{ name: '', bbox: { x: '', y: '', width: '', height: '' } }],
};

export default function App() {
  const [formData, setFormData] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [fileError, setFileError] = useState('');
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isInitialMount = useRef(true);

  // Load saved form data on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setFormData(JSON.parse(saved));
      } catch {
        console.warn('Could not parse saved form data');
      }
    }
  }, []);

  // Save form data on change (skip first mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
    }
  }, [formData]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAbnormalityChange = (i, field, value) => {
    const arr = [...formData.abnormalities];
    if (field === 'name') arr[i].name = value;
    else arr[i].bbox[field] = value;
    setFormData((prev) => ({ ...prev, abnormalities: arr }));
  };

  const addAbnormality = () =>
    setFormData((prev) => ({
      ...prev,
      abnormalities: [
        ...prev.abnormalities,
        { name: '', bbox: { x: '', y: '', width: '', height: '' } },
      ],
    }));

  const removeAbnormality = (i) =>
    setFormData((prev) => ({
      ...prev,
      abnormalities: prev.abnormalities.filter((_, idx) => idx !== i),
    }));

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    setFileName(file ? file.name : '');
    setFileError('');
  };

  const validate = () => {
    const newErrors = {};
    if (formData.isAbnormal && formData.abnormalities.length === 0) {
      newErrors.abnormalities = 'At least one abnormality is required if X-ray is abnormal';
    } else if (formData.isAbnormal) {
      formData.abnormalities.forEach((ab, i) => {
        if (!ab.name) newErrors[`abnormalityName${i}`] = 'Required';
        Object.entries(ab.bbox).forEach(([k, v]) => {
          if (v && (isNaN(v) || Number(v) < 0)) {
            newErrors[`bbox${i}${k}`] = 'Must be a non-negative number';
          }
        });
      });
    }
    const fileInput = document.getElementById('file-upload');
    if (!fileInput.files[0]) {
      setFileError('X-ray file is required');
      return false;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setFormData(initialState);
    setErrors({});
    setFileName('');
    setFileError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsLoading(true);
    const payload = new FormData();
    const fileInput = document.getElementById('file-upload');
    payload.append('file', fileInput.files[0]);
    Object.entries(formData).forEach(([key, value]) => {
      payload.append(key, key === 'abnormalities' ? JSON.stringify(value) : value || 'N/A');
    });

    try {
      const res = await fetch(`${API_URL}/generate-report/`, {
        method: 'POST',
        body: payload,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to generate report');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'medical_report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-3xl font-bold text-center mb-8">RadioIQ Report Generator</h1>
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-8 bg-white p-8 rounded-lg shadow">
        {/* Patient Details */}
        <div>
          <h2 className="text-xl font-semibold">Patient Details</h2>
          <p className="text-sm text-gray-600 mb-4">Enter patient information</p>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[
              ['patientName', 'Patient Name', 'text'],
              ['dateOfExam', 'Date of Examination', 'date'],
              ['patientId', 'Patient ID', 'text'],
              ['gender', 'Gender', 'select', ['Male', 'Female', 'Other']],
              ['age', 'Age', 'number'],
              ['location', 'Location', 'text'],
              ['referredPhysician', 'Referred Physician', 'text'],
              ['radiologist', 'Radiologist', 'text'],
              ['examType', 'Examination Type', 'text'],
            ].map(([name, label, type, options]) => (
              <div key={name}>
                <label htmlFor={name} className="block text-sm font-medium text-gray-700">{label}</label>
                {type === 'select' ? (
                  <select
                    id={name}
                    name={name}
                    value={formData[name]}
                    onChange={handleChange}
                    className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Select</option>
                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input
                    id={name}
                    name={name}
                    type={type}
                    value={formData[name]}
                    onChange={handleChange}
                    className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                )}
                {errors[name] && <p className="text-red-600 text-sm mt-1">{errors[name]}</p>}
              </div>
            ))}
            <div className="sm:col-span-2">
              <label htmlFor="bodyPart" className="block text-sm font-medium text-gray-700">Body Part Examined</label>
              <input
                id="bodyPart"
                name="bodyPart"
                type="text"
                value={formData.bodyPart}
                onChange={handleChange}
                className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
              {errors.bodyPart && <p className="text-red-600 text-sm mt-1">{errors.bodyPart}</p>}
            </div>
          </div>
        </div>

        {/* X-ray Details */}
        <div>
          <h2 className="text-xl font-semibold">X-ray Details</h2>
          <div className="space-y-4 mt-4">
            <div>
              <label htmlFor="isAbnormal" className="block text-sm font-medium text-gray-700">X-ray Status</label>
              <select
                id="isAbnormal"
                name="isAbnormal"
                value={formData.isAbnormal ? 'abnormal' : 'normal'}
                onChange={e => setFormData(prev => ({ ...prev, isAbnormal: e.target.value === 'abnormal' }))}
                className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="normal">Normal</option>
                <option value="abnormal">Abnormal</option>
              </select>
            </div>

         


            {formData.isAbnormal && (
              <div>
                
                <label className="block text-sm font-medium text-gray-700">Abnormalities</label>

                <div className="text-sm text-gray-500">
              Note: BBOX coordinates are relative to the image size 1024*1024.
            </div>
        
                {formData.abnormalities.map((ab, idx) => (
                  
                  <div key={idx} className="mt-2 p-4 border rounded-md">
                    <label className="block text-sm font-medium text-gray-700">Abnormality Name</label>
                    <input
                      type="text"
                      value={ab.name}
                      onChange={e => handleAbnormalityChange(idx, 'name', e.target.value)}
                      className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    {errors[`abnormalityName${idx}`] && <p className="text-red-600 text-sm mt-1">{errors[`abnormalityName${idx}`]}</p>}

                    <div className="grid grid-cols-2 gap-4 mt-2">
                      {['x', 'y', 'width', 'height'].map(coord => (
                        <div key={coord}>
                          <label className="block text-xs text-gray-600 capitalize">{coord}</label>
                          <input
                            type="number"
                            value={ab.bbox[coord]}
                            onChange={e => handleAbnormalityChange(idx, coord, e.target.value)}
                            className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                          />
                          {errors[`bbox${idx}${coord}`] && <p className="text-red-600 text-xs mt-1">{errors[`bbox${idx}${coord}`]}</p>}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAbnormality(idx)}
                      className="mt-2 text-sm text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addAbnormality}
                  className="mt-2 inline-flex justify-center py-1 px-2 border border-transparent text-sm font-medium rounded-md text-indigo-600 hover:bg-indigo-100"
                >
                  Add Abnormality
                </button>
                {errors.abnormalities && <p className="text-red-600 text-sm mt-1">{errors.abnormalities}</p>}
              </div>
            )}

            <div>
              <label htmlFor="tbPossibility" className="block text-sm font-medium text-gray-700">TB Possibility</label>
              <input
                id="tbPossibility"
                name="tbPossibility"
                type="text"
                value={formData.tbPossibility}
                onChange={handleChange}
                className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="doctorNotes" className="block text-sm font-medium text-gray-700">Doctor Notes</label>
              <textarea
                id="doctorNotes"
                name="doctorNotes"
                rows={3}
                value={formData.doctorNotes}
                onChange={handleChange}
                className="mt-1 block w-full border border-gray-300 rounded-md p-2 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Upload X-ray</label>
          <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed border-gray-300 rounded-md">
            <div className="space-y-1 text-center">
              <PhotoIcon className="mx-auto h-10 w-10 text-gray-400" aria-hidden="true" />
              <div className="flex text-sm text-gray-600">
                <label htmlFor="file-upload" className="relative cursor-pointer bg-white font-medium text-indigo-600 hover:text-indigo-500">
                  <span>Upload a file</span>
                  <input
                    id="file-upload"
                    type="file"
                    className="sr-only"
                    accept=".dcm,.dicom,.dic,.png"
                    onChange={handleFileChange}
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">DICOM, PNG up to 10MB</p>
              {fileName && <p className="text-xs text-gray-700">Uploaded: {fileName}</p>}
              {fileError && <p className="text-red-600 text-xs mt-1">{fileError}</p>}
            </div>
          </div>
        </div>

        {/* Reset & Generate */}
        <div className="flex justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-100"
          >
            <TrashIcon className="h-5 w-5 mr-2 text-gray-600" />
            Reset
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className={`inline-flex items-center justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white ${
              isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {isLoading && (
              <svg className="animate-spin h-5 w-5 mr-2 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {isLoading ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </form>
    </div>
  );
}

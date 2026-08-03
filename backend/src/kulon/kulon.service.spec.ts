import 'reflect-metadata';
import { KulonService } from './kulon.service';

describe('KulonService', () => {
  let svc: KulonService;
  beforeEach(() => {
    svc = new KulonService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('gets courses from timeline classification endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            courses: [
              { id: 1, fullname: 'Course A', shortname: 'CA', idnumber: '1' },
            ],
          },
        },
      ],
    });
    const courses = await svc.getCourses('session-cookie', 'sesskey');
    expect(courses[0].fullname).toBe('Course A');
    expect(courses[0].id).toBe(1);
  });

  it('gets assignments with deadlines from calendar endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          error: false,
          data: {
            events: [
              {
                id: 1165,
                activityname: 'Tugas Kelompok I',
                modulename: 'assign',
                eventtype: 'due',
                timestart: 1742230800,
                overdue: true,
                course: { id: 9371, fullname: 'Metode Numerik D' },
              },
            ],
          },
        },
      ],
    });
    const assignments = await svc.getAssignments('session-cookie', 'sesskey');
    expect(assignments[0].name).toBe('Tugas Kelompok I');
    expect(assignments[0].duedate).toBe(1742230800);
    expect(assignments[0].course).toBe('Metode Numerik D');
    expect(assignments[0].overdue).toBe(true);
  });

  it('extracts sesskey from page html', async () => {
    const html = `<form><input type="hidden" name="sesskey" value="abc123XYZ"></form>`;
    const key = svc.parseSesskey(html);
    expect(key).toBe('abc123XYZ');
  });
});
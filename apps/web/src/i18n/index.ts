/**
 * i18n —— 中英双语（AGENTS.md 要求：文案经 t() 包裹）。
 * 保留迁移前全部 ~130 个 key（结构与旧 i18n/index.ts 一致），并补齐新页面/组件所需 key。
 * 单一 translation 命名空间，资源内联（无 http 后端，冷启动即可用）。
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  'zh-CN': {
    translation: {
      app: { title: '校园值周管理', subtitle: 'Class Duty Management System' },
      auth: { login: '登录', logout: '退出', username: '用户名', password: '密码', loginLoading: '登录中...', passwordPlaceholder: '请输入密码', usernamePlaceholder: '请输入用户名', testAccounts: '测试账号（密码均为 123456）：', loginFailed: '登录失败' },
      nav: { dashboard: '看板', records: '值周记录', stats: '统计排名', summary: '每日小结', appeals: '申诉管理', awards: '流动红旗', dutySchedule: '值班大表', dutyCheckin: '执勤打卡', dutyInspection: '领导巡查', dutySwap: '调班申请', dutyReport: '值班统计', dutyConfig: '值班配置', config: '配置中心', settings: '系统设置', bigscreen: '大屏' },
      roles: { admin: '管理员', teacher: '教师', student: '值周生' },
      common: { save: '保存', cancel: '取消', delete: '删除', edit: '编辑', create: '创建', refresh: '刷新', search: '搜索', export: '导出', import: '导入', confirm: '确认', submit: '提交', loading: '加载中...', noData: '暂无数据', back: '返回', close: '关闭', all: '全部', actions: '操作', name: '名称', status: '状态', week: '周次', campus: '校区', grade: '年级', class: '班级', success: '操作成功', failed: '操作失败' },
      dashboard: { todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', weekBest: '本周最优', weekTop5: '本周排名 Top 5', recentRecords: '最新记录' },
      records: { title: '值周记录', newRecord: '新增记录', quickTemplate: '快速模板', class: '班级', week: '周次', tag: '评价标签', score: '分数', tagDefaultScore: '标签默认分', comment: '文字说明', commentPlaceholder: '例：3楼走廊卫生整洁...', uploadImage: '点击上传图片', maxImages: '最多9张', filterByWeek: '按周筛选', filterByClass: '按班级筛选', recordList: '记录列表', status: { active: '正常', revoked: '已撤回', appealing: '申诉中', appeal_approved: '申诉通过' }, revoke: '撤回', appeal: '申诉', appealReason: '请输入申诉理由：', confirmRevoke: '确认撤回此记录？', selectClassAndTag: '请选择班级', recorder: '记录人', time: '时间', created: '记录已创建', revokedOk: '已撤回', appealedOk: '申诉已提交', uploadFailed: '图片上传失败' },
      stats: { title: '统计排名', ranking: '班级排名', trend: '趋势图', detail: '明细', exportCSV: '导出 CSV', selectClass: '请选择班级', selectGrade: '全部年级', recentTrend: '近8周趋势', rank: '排名', className: '班级', totalScore: '总分', positiveCount: '加分次数', negativeCount: '扣分次数', recordCount: '记录数' },
      summary: { title: '每日小结', newSummary: '新增小结', date: '日期', content: '小结内容（支持 Markdown）', autoHint: '留空将自动生成本周排名摘要...', historySummaries: '历史小结', autoContent: '今日无值周记录。', weekRanking: '{{week}} 周排名', created: '小结已保存' },
      appeals: { title: '申诉管理', allStatus: '全部状态', pending: '待审批', approved: '已批准', rejected: '已驳回', teacher: '申诉人', reason: '申诉理由', reviewer: '审批人', approve: '批准', reject: '驳回', reviewComment: '审批意见', approvedOk: '已批准', rejectedOk: '已驳回', recordInfo: '关联记录' },
      awards: { title: '流动红旗', awardButton: '颁发流动红旗', awarding: '评选中...', confirmAward: '确认为 {{week}} 颁发流动红旗？将自动评选各年级最高分班级。', noRecords: '暂无流动红旗记录，点击上方按钮自动评选', awardedAt: '颁发时间', awardedOk: '流动红旗已颁发', category: '类别', note: '备注' },
      config: { title: '配置中心', tabs: { campuses: '校区', grades: '年级', classes: '班级', users: '用户', groups: '值周小组', tags: '标签', templates: '模板' }, newItem: '新增', editItem: '编辑', deleteConfirm: '确认删除？', code: '代号', sortOrder: '排序', classTeacher: '班主任', displayName: '姓名', role: '角色', members: '成员', score: '分值', color: '颜色', category: '类别', isSystem: '系统标签', tagIds: '标签', createdOk: '创建成功', updatedOk: '更新成功', deletedOk: '删除成功' },
      settings: { title: '系统设置', campusSettings: '校区设置', appealToggle: '申诉功能', appealDesc: '开启后班主任可对值周记录发起申诉', notifyToggle: '自动通知教师', notifyDesc: '每日小结自动推送给相关教师', enabled: '已开启', disabled: '已关闭', importTemplates: '导入模板', exportTemplates: '导出模板', savedOk: '设置已保存' },
      bigscreen: { title: '校园值周数字大屏', todayRecords: '今日记录', todayPositive: '今日加分', todayNegative: '今日扣分', bestClass: '最优班级', weekRankingTop10: '本周排名 Top 10', liveFeed: '实时记录滚动', live: '实时', noRecords: '暂无记录' },
      duty: {
        area: '区域', location: '值班地点', timeSlot: '值班时段', kind: '排班类型', kindTeaching: '教师执勤', kindDutyWeek: '值周巡查',
        thisWeek: '本周', lastWeek: '上一周', nextWeek: '下一周', unassignedLoc: '未指定地点',
        pill: { swapped: '已换班', done: '已执勤', pending: '未执勤' },
        summary: { total: '本周班次', done: '已执勤', pending: '待执勤', swapped: '已换班' },
        schedule: { title: '值班大表', matrix: '排班矩阵', mySummary: '我的执勤', noMyTask: '本周暂无我的执勤任务', empty: '本周暂无排班数据' },
        checkin: { title: '执勤打卡', todayTasks: '今日执勤任务', done: '已完成', todo: '待执勤', situation: '情况说明', situationPh: '例：到岗正常，无异常情况...', photos: '现场照片', photosRequired: '现场照片（至少 1 张）', submit: '提交打卡', checkedIn: '已打卡', notMine: '非本人班次', viaSwap: '经调班接手', noTask: '今日无执勤任务', ok: '打卡成功', needPhoto: '请上传至少 1 张现场照片' },
        inspection: { title: '领导巡查', newInspection: '新增巡查', area: '巡查区域', date: '巡查日期', items: '巡查明细', location: '地点', teacher: '被巡查教师', present: '在岗', absent: '不在岗', addRow: '从今日排班加载', submit: '提交巡查', empty: '暂无巡查记录', ok: '巡查已提交', noRows: '请先加载/填写巡查明细', needStatus: '每行须选在岗/不在岗', noPermission: '无巡查权限' },
        swap: { title: '调班申请', newSwap: '发起调班', type: '调班类型', typeSwap: '交换', typeProxy: '代理', mySchedule: '我的排班', targetTeacher: '对方教师', targetSchedule: '对方排班', reason: '调班原因', reasonPh: '请说明调班原因...', submit: '提交申请', ok: '调班申请已提交', pending: '待审批', approved: '已通过', rejected: '已拒绝', approve: '批准', reject: '驳回', reviewComment: '审批意见', applicant: '申请人', empty: '暂无调班申请', reviewed: '已审批', myApplied: '我发起的', toMe: '待我处理', pickDate: '选择日期' },
        report: { title: '值班统计', attendance: '到岗率', scheduled: '应到人次', checkedIn: '实到人次', rate: '到岗率', byTeacher: '按教师明细', teacher: '教师', dateFrom: '开始日期', dateTo: '结束日期', query: '查询', kind: '排班类型', logReport: '值班日志', checkinDetail: '打卡明细' },
        config: { title: '值班配置', areas: '区域', locations: '值班地点', timeSlots: '值班时段', schedules: '排班模板', newArea: '新增区域', newLocation: '新增地点', newSlot: '新增时段', newSchedule: '新增排班', weekday: '周内日', weekParity: '单双周', parityEvery: '每周', parityOdd: '奇数周', parityEven: '偶数周', countersign: '会签（多人同岗）', assignees: '值班人员', dateStart: '开始日期', dateEnd: '结束日期', startMinute: '开始(分钟)', endMinute: '结束(分钟)', priority: '优先级', sortOrder: '排序', importExcel: '导入排班', saveOk: '已保存', delOk: '已删除' },
        weekdayName: { '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六' },
      },
      error: { unauthorized: '请先登录', forbidden: '权限不足', notFound: '资源不存在', network: '网络错误' },
    },
  },
  en: {
    translation: {
      app: { title: 'Class Duty Management', subtitle: 'Class Duty Management System' },
      auth: { login: 'Sign In', logout: 'Sign Out', username: 'Username', password: 'Password', loginLoading: 'Signing in...', passwordPlaceholder: 'Enter password', usernamePlaceholder: 'Enter username', testAccounts: 'Test accounts (password: 123456):', loginFailed: 'Sign in failed' },
      nav: { dashboard: 'Dashboard', records: 'Duty Records', stats: 'Statistics', summary: 'Daily Summary', appeals: 'Appeals', awards: 'Red Flag', dutySchedule: 'Duty Board', dutyCheckin: 'Check-in', dutyInspection: 'Inspection', dutySwap: 'Swap Request', dutyReport: 'Duty Report', dutyConfig: 'Duty Config', config: 'Configuration', settings: 'Settings', bigscreen: 'Big Screen' },
      roles: { admin: 'Admin', teacher: 'Teacher', student: 'Prefect' },
      common: { save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', create: 'Create', refresh: 'Refresh', search: 'Search', export: 'Export', import: 'Import', confirm: 'Confirm', submit: 'Submit', loading: 'Loading...', noData: 'No data', back: 'Back', close: 'Close', all: 'All', actions: 'Actions', name: 'Name', status: 'Status', week: 'Week', campus: 'Campus', grade: 'Grade', class: 'Class', success: 'Success', failed: 'Failed' },
      dashboard: { todayRecords: 'Today Records', todayPositive: 'Today Positive', todayNegative: 'Today Negative', weekBest: 'Best Class', weekTop5: 'Weekly Top 5', recentRecords: 'Recent Records' },
      records: { title: 'Duty Records', newRecord: 'New Record', quickTemplate: 'Templates', class: 'Class', week: 'Week', tag: 'Tag', score: 'Score', tagDefaultScore: 'Tag Default', comment: 'Comment', commentPlaceholder: 'e.g. Clean hallway on 3F...', uploadImage: 'Click to upload', maxImages: 'Max 9 images', filterByWeek: 'Filter by Week', filterByClass: 'Filter by Class', recordList: 'Record List', status: { active: 'Active', revoked: 'Revoked', appealing: 'Appealing', appeal_approved: 'Approved' }, revoke: 'Revoke', appeal: 'Appeal', appealReason: 'Enter appeal reason:', confirmRevoke: 'Confirm revoke?', selectClassAndTag: 'Select a class', recorder: 'Recorder', time: 'Time', created: 'Record created', revokedOk: 'Revoked', appealedOk: 'Appeal submitted', uploadFailed: 'Image upload failed' },
      stats: { title: 'Statistics', ranking: 'Rankings', trend: 'Trend', detail: 'Details', exportCSV: 'Export CSV', selectClass: 'Select a class', selectGrade: 'All Grades', recentTrend: '8-Week Trend', rank: 'Rank', className: 'Class', totalScore: 'Score', positiveCount: 'Positive', negativeCount: 'Negative', recordCount: 'Records' },
      summary: { title: 'Daily Summary', newSummary: 'New Summary', date: 'Date', content: 'Content (Markdown)', autoHint: 'Leave blank to auto-generate...', historySummaries: 'History', autoContent: 'No records today.', weekRanking: '{{week}} Rankings', created: 'Summary saved' },
      appeals: { title: 'Appeals', allStatus: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', teacher: 'Appellant', reason: 'Reason', reviewer: 'Reviewer', approve: 'Approve', reject: 'Reject', reviewComment: 'Comment', approvedOk: 'Approved', rejectedOk: 'Rejected', recordInfo: 'Related Record' },
      awards: { title: 'Red Flag Awards', awardButton: 'Award Red Flag', awarding: 'Awarding...', confirmAward: 'Confirm {{week}} red flag? Top class per grade will be selected.', noRecords: 'No awards yet. Click above to auto-award.', awardedAt: 'Awarded at', awardedOk: 'Red flag awarded', category: 'Category', note: 'Note' },
      config: { title: 'Configuration', tabs: { campuses: 'Campuses', grades: 'Grades', classes: 'Classes', users: 'Users', groups: 'Groups', tags: 'Tags', templates: 'Templates' }, newItem: 'New', editItem: 'Edit', deleteConfirm: 'Confirm delete?', code: 'Code', sortOrder: 'Order', classTeacher: 'Teacher', displayName: 'Name', role: 'Role', members: 'Members', score: 'Score', color: 'Color', category: 'Category', isSystem: 'System', tagIds: 'Tags', createdOk: 'Created', updatedOk: 'Updated', deletedOk: 'Deleted' },
      settings: { title: 'Settings', campusSettings: 'Campus Settings', appealToggle: 'Appeal Feature', appealDesc: 'Allow teachers to appeal duty records', notifyToggle: 'Auto-Notify', notifyDesc: 'Auto-push daily summaries to teachers', enabled: 'Enabled', disabled: 'Disabled', importTemplates: 'Import Templates', exportTemplates: 'Export Templates', savedOk: 'Settings saved' },
      bigscreen: { title: 'Campus Duty Big Screen', todayRecords: 'Records', todayPositive: 'Positive', todayNegative: 'Negative', bestClass: 'Best', weekRankingTop10: 'Weekly Top 10', liveFeed: 'Live Feed', live: 'LIVE', noRecords: 'No records' },
      duty: {
        area: 'Area', location: 'Location', timeSlot: 'Time Slot', kind: 'Schedule Type', kindTeaching: 'Teaching Duty', kindDutyWeek: 'Prefect Patrol',
        thisWeek: 'This Week', lastWeek: 'Prev', nextWeek: 'Next', unassignedLoc: 'Unassigned',
        pill: { swapped: 'Swapped', done: 'Checked In', pending: 'Pending' },
        summary: { total: 'Shifts', done: 'Checked In', pending: 'Pending', swapped: 'Swapped' },
        schedule: { title: 'Duty Board', matrix: 'Schedule Matrix', mySummary: 'My Duties', noMyTask: 'No duties for you this week', empty: 'No schedule data this week' },
        checkin: { title: 'Duty Check-in', todayTasks: "Today's Tasks", done: 'Done', todo: 'To Do', situation: 'Situation', situationPh: 'e.g. On duty, all normal...', photos: 'Photos', photosRequired: 'Photos (at least 1)', submit: 'Check In', checkedIn: 'Checked In', notMine: 'Not your shift', viaSwap: 'Via swap', noTask: 'No duty today', ok: 'Checked in', needPhoto: 'Please upload at least 1 photo' },
        inspection: { title: 'Inspection', newInspection: 'New Inspection', area: 'Area', date: 'Date', items: 'Details', location: 'Location', teacher: 'Teacher', present: 'Present', absent: 'Absent', addRow: 'Load from today', submit: 'Submit', empty: 'No inspection records', ok: 'Inspection submitted', noRows: 'Load or fill inspection rows first', needStatus: 'Each row needs present/absent', noPermission: 'No inspection permission' },
        swap: { title: 'Swap Request', newSwap: 'New Swap', type: 'Type', typeSwap: 'Swap', typeProxy: 'Proxy', mySchedule: 'My Shift', targetTeacher: 'Target Teacher', targetSchedule: 'Target Shift', reason: 'Reason', reasonPh: 'Explain the reason...', submit: 'Submit', ok: 'Swap request submitted', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', approve: 'Approve', reject: 'Reject', reviewComment: 'Comment', applicant: 'Applicant', empty: 'No swap requests', reviewed: 'Reviewed', myApplied: 'My Requests', toMe: 'For Me', pickDate: 'Pick date' },
        report: { title: 'Duty Report', attendance: 'Attendance', scheduled: 'Scheduled', checkedIn: 'Checked In', rate: 'Rate', byTeacher: 'By Teacher', teacher: 'Teacher', dateFrom: 'From', dateTo: 'To', query: 'Query', kind: 'Type', logReport: 'Duty Log', checkinDetail: 'Check-in Detail' },
        config: { title: 'Duty Config', areas: 'Areas', locations: 'Locations', timeSlots: 'Time Slots', schedules: 'Schedules', newArea: 'New Area', newLocation: 'New Location', newSlot: 'New Slot', newSchedule: 'New Schedule', weekday: 'Weekday', weekParity: 'Week Parity', parityEvery: 'Every Week', parityOdd: 'Odd Weeks', parityEven: 'Even Weeks', countersign: 'Countersign', assignees: 'Assignees', dateStart: 'Start Date', dateEnd: 'End Date', startMinute: 'Start (min)', endMinute: 'End (min)', priority: 'Priority', sortOrder: 'Order', importExcel: 'Import', saveOk: 'Saved', delOk: 'Deleted' },
        weekdayName: { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' },
      },
      error: { unauthorized: 'Please sign in', forbidden: 'Forbidden', notFound: 'Not found', network: 'Network error' },
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
});

export default i18n;

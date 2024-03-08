class Solution {
    public int minSubArrayLen(int target, int[] nums) {
        int count = 0;
        for (int i = 0; i < nums.length; i++) {
            int sum_tmp = 0;
            int count_tmp = 0;
            for (int j = i; j < nums.length; j++) {
                sum_tmp += nums[j];
                count_tmp++;
                if (sum_tmp >= target) {
                    if (count == 0 || count_tmp < count) {
                        count = count_tmp;
                        break;
                    }
                }
            }
        }
        return count;
    }
}

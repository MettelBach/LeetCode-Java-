class Solution {
    public int[] twoSum(int[] nums, int target) {
        int[] array = {-1, -1};

        for (int i = 0; i < nums.length; i++) {
            for (int k = 0; k < nums.length; k++) {
                if (k == i) continue;
                int sum = nums[i] + nums[k];
                if (sum == target) {
                    array[0] = i;
                    array[1] = k;
                    return array;
                }
            }
        }
        return array;
    }
}